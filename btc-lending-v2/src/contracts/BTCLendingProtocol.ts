/**
 * BTCLendingProtocol v2 — Tam OP_20 Token Akışı ile
 *
 * ─── Token Akışı ─────────────────────────────────────────────────────────────
 *
 *  depositLiquidity(amount):
 *    Kullanıcı önce loanToken.approve(lendingContract, amount) çağırır.
 *    Sonra lendingContract.depositLiquidity(amount) çağırır.
 *    Kontrat: loanToken.transferFrom(caller, self, amount) → havuz artar.
 *
 *  withdrawLiquidity(amount):
 *    Kontrat: loanToken.transfer(caller, amount + interest) → havuz azalır.
 *
 *  depositCollateral(amount):
 *    Kullanıcı önce collateralToken.approve(lendingContract, amount) çağırır.
 *    Kontrat: collateralToken.transferFrom(caller, self, amount) → teminat kilitlenir.
 *
 *  borrow(loanAmount, colPrice):
 *    Kontrat: loanToken.transfer(caller, loanAmount) → borçlu alır.
 *
 *  repay():
 *    Kullanıcı önce loanToken.approve(lendingContract, totalDebt) çağırır.
 *    Kontrat: loanToken.transferFrom(caller, self, totalDebt) → borç kapatılır.
 *    Kontrat: collateralToken.transfer(caller, collateral) → teminat iade edilir.
 *
 *  liquidate(borrower, colPrice):
 *    Tasfiyeci önce loanToken.approve(lendingContract, totalDebt) çağırır.
 *    Kontrat: loanToken.transferFrom(liquidator, self, totalDebt) → borç kapatılır.
 *    Kontrat: collateralToken.transfer(liquidator, collateral + bonus) → tasfiyeci alır.
 *
 * ─── OP_NET Bitcoin Kısıtlaması Not ─────────────────────────────────────────
 *    OP_NET'te kontratlar doğrudan BTC tutamaz. Bunun yerine OP_20 wrapper token
 *    (örn. WBTC benzeri bir OP_20 token) kullanılır. Tüm transferler OP_20
 *    standardı üzerinden gerçekleşir.
 */

import {
    Address,
    AddressMemoryMap,
    Blockchain,
    BytesWriter,
    Calldata,
    encodeSelector,
    OP_NET,
    Selector,
    StoredBoolean,
    StoredU256,
} from '@btc-vision/btc-runtime/runtime';
import { u256 } from 'as-bignum/assembly';

import { Ptr, Config }                 from '../storage/StoragePointers';
import { op20TransferFrom, op20Transfer, op20Allowance } from '../interfaces/IOP20';
import {
    LiquidityDepositedEvent,
    LiquidityWithdrawnEvent,
    CollateralDepositedEvent,
    CollateralWithdrawnEvent,
    BorrowedEvent,
    RepaidEvent,
    LiquidatedEvent,
    ParametersUpdatedEvent,
} from '../events/LendingEvents';

@final
export class BTCLendingProtocol extends OP_NET {

    // ─── Protokol Parametreleri ───────────────────────────────────────────────
    private _interestBps      : StoredU256;
    private _colRatioPct      : StoredU256;
    private _liqThreshPct     : StoredU256;
    private _liqBonusBps      : StoredU256;
    private _totalLiquidity   : StoredU256;
    private _totalBorrowed    : StoredU256;
    private _owner            : StoredU256;
    private _loanTokenAddr    : StoredU256;   // Address → u256
    private _colTokenAddr     : StoredU256;

    // ─── Lender Mapping'leri ──────────────────────────────────────────────────
    private _lenderDeposited  : AddressMemoryMap<Address, StoredU256>;
    private _lenderBlock      : AddressMemoryMap<Address, StoredU256>;
    private _lenderAccrued    : AddressMemoryMap<Address, StoredU256>;

    // ─── Borrower Mapping'leri ────────────────────────────────────────────────
    private _borrowerCol      : AddressMemoryMap<Address, StoredU256>;
    private _borrowerDebt     : AddressMemoryMap<Address, StoredU256>;
    private _borrowerBlock    : AddressMemoryMap<Address, StoredU256>;
    private _borrowerActive   : AddressMemoryMap<Address, StoredBoolean>;

    // ─── Constructor ─────────────────────────────────────────────────────────

    public constructor() {
        super();

        this._interestBps    = new StoredU256(Ptr.ANNUAL_INTEREST_BPS,    u256.Zero, u256.Zero);
        this._colRatioPct    = new StoredU256(Ptr.COLLATERAL_RATIO_PCT,   u256.Zero, u256.Zero);
        this._liqThreshPct   = new StoredU256(Ptr.LIQUIDATION_THRESH_PCT, u256.Zero, u256.Zero);
        this._liqBonusBps    = new StoredU256(Ptr.LIQUIDATION_BONUS_BPS,  u256.Zero, u256.Zero);
        this._totalLiquidity = new StoredU256(Ptr.TOTAL_LIQUIDITY,        u256.Zero, u256.Zero);
        this._totalBorrowed  = new StoredU256(Ptr.TOTAL_BORROWED,         u256.Zero, u256.Zero);
        this._owner          = new StoredU256(Ptr.OWNER,                  u256.Zero, u256.Zero);
        this._loanTokenAddr  = new StoredU256(Ptr.LOAN_TOKEN_ADDR,        u256.Zero, u256.Zero);
        this._colTokenAddr   = new StoredU256(Ptr.COLLATERAL_TOKEN_ADDR,  u256.Zero, u256.Zero);

        this._lenderDeposited = new AddressMemoryMap<Address, StoredU256>(Ptr.LENDER_DEPOSITED,        u256.Zero);
        this._lenderBlock     = new AddressMemoryMap<Address, StoredU256>(Ptr.LENDER_DEPOSIT_BLOCK,    u256.Zero);
        this._lenderAccrued   = new AddressMemoryMap<Address, StoredU256>(Ptr.LENDER_ACCRUED_INTEREST, u256.Zero);

        this._borrowerCol    = new AddressMemoryMap<Address, StoredU256>(Ptr.BORROWER_COLLATERAL,  u256.Zero);
        this._borrowerDebt   = new AddressMemoryMap<Address, StoredU256>(Ptr.BORROWER_DEBT,        u256.Zero);
        this._borrowerBlock  = new AddressMemoryMap<Address, StoredU256>(Ptr.BORROWER_BORROW_BLOCK, u256.Zero);
        this._borrowerActive = new AddressMemoryMap<Address, StoredBoolean>(Ptr.BORROWER_ACTIVE,   false);
    }

    // ─── Giriş Noktası ───────────────────────────────────────────────────────

    public override execute(method: Selector, calldata: Calldata): BytesWriter {
        switch (method) {
            case encodeSelector('onDeployment'):   return this._deploy(calldata);
            case encodeSelector('depositLiquidity'):  return this._depositLiquidity(calldata);
            case encodeSelector('withdrawLiquidity'): return this._withdrawLiquidity(calldata);
            case encodeSelector('depositCollateral'): return this._depositCollateral(calldata);
            case encodeSelector('borrow'):            return this._borrow(calldata);
            case encodeSelector('repay'):             return this._repay(calldata);
            case encodeSelector('liquidate'):         return this._liquidate(calldata);
            case encodeSelector('updateParameters'):  return this._updateParameters(calldata);
            // View
            case encodeSelector('getCollateralRatio'):  return this._getColRatio(calldata);
            case encodeSelector('getTotalDebt'):         return this._getTotalDebt(calldata);
            case encodeSelector('getPendingInterest'):   return this._getPendingInterest(calldata);
            case encodeSelector('utilizationRate'):      return this._utilizationRate();
            case encodeSelector('getLenderInfo'):        return this._getLenderInfo(calldata);
            case encodeSelector('getBorrowerPosition'):  return this._getBorrowerPos(calldata);
            case encodeSelector('checkAllowance'):       return this._checkAllowance(calldata);
            default:
                throw new Error('Bilinmeyen metod');
        }
    }

    // ─── Dağıtım ─────────────────────────────────────────────────────────────

    /**
     * onDeployment(loanToken: Address, collateralToken: Address,
     *              interestBps: u64, colRatio: u64, liqThresh: u64, liqBonus: u64)
     */
    private _deploy(calldata: Calldata): BytesWriter {
        assert(u256.eq(this._owner.value, u256.Zero), 'Zaten baslatildi');

        const loanToken   = calldata.readAddress();
        const colToken    = calldata.readAddress();
        const interestBps = calldata.readU64();
        const colRatio    = calldata.readU64();
        const liqThresh   = calldata.readU64();
        const liqBonus    = calldata.readU64();

        assert(colRatio > liqThresh, 'Teminat orani > tasfiye esigi olmali');

        this._loanTokenAddr.value = loanToken.toU256();
        this._colTokenAddr.value  = colToken.toU256();
        this._interestBps.value   = u256.fromU64(interestBps);
        this._colRatioPct.value   = u256.fromU64(colRatio);
        this._liqThreshPct.value  = u256.fromU64(liqThresh);
        this._liqBonusBps.value   = u256.fromU64(liqBonus);
        this._owner.value         = Blockchain.callerAddress.toU256();

        return this._bool(true);
    }

    // ─── Lender: Likidite Yatır ───────────────────────────────────────────────

    /**
     * depositLiquidity(amount: u256)
     *
     * Ön koşul: Kullanıcı → loanToken.approve(lendingContract, amount) çağırmış olmalı
     */
    private _depositLiquidity(calldata: Calldata): BytesWriter {
        const amount = calldata.readU256();
        assert(!u256.eq(amount, u256.Zero), 'Sifir miktar');

        const caller    = Blockchain.callerAddress;
        const self      = Blockchain.contractAddress;
        const loanToken = Address.fromU256(this._loanTokenAddr.value);

        // ── Allowance kontrolü ────────────────────────────────────────────────
        const allowance = op20Allowance(loanToken, caller, self);
        assert(u256.ge(allowance, amount), 'Onay yetersiz: once loanToken.approve() cagirin');

        // ── Token transferi: kullanıcı → kontrat ──────────────────────────────
        const ok = op20TransferFrom(loanToken, caller, self, amount);
        assert(ok, 'loanToken transferFrom basarisiz');

        // ── Birikmiş faizi güncelle ───────────────────────────────────────────
        const deposited = this._lenderDeposited.getOrDefault(caller, u256.Zero);
        if (!u256.eq(deposited.value, u256.Zero)) {
            const accrued = this._lenderAccrued.getOrDefault(caller, u256.Zero);
            accrued.value = u256.add(accrued.value, this._calcLenderInterest(caller));
        }

        // ── Bakiyeleri güncelle ───────────────────────────────────────────────
        deposited.value = u256.add(deposited.value, amount);
        this._lenderDeposited.set(caller, deposited);

        const block = this._lenderBlock.getOrDefault(caller, u256.Zero);
        block.value = Blockchain.blockNumber;
        this._lenderBlock.set(caller, block);

        this._totalLiquidity.value = u256.add(this._totalLiquidity.value, amount);

        this.emitEvent(new LiquidityDepositedEvent(caller, amount));
        return this._bool(true);
    }

    // ─── Lender: Likidite Çek ─────────────────────────────────────────────────

    /**
     * withdrawLiquidity(amount: u256)  — amount=0 tamamını çeker
     */
    private _withdrawLiquidity(calldata: Calldata): BytesWriter {
        const amount = calldata.readU256();
        const caller = Blockchain.callerAddress;

        const deposited = this._lenderDeposited.get(caller);
        assert(deposited !== null && !u256.eq(deposited!.value, u256.Zero), 'Yatirilan tutar yok');

        // Birikmiş faizi hesapla
        const accrued  = this._lenderAccrued.getOrDefault(caller, u256.Zero);
        accrued.value  = u256.add(accrued.value, this._calcLenderInterest(caller));

        const block    = this._lenderBlock.getOrDefault(caller, u256.Zero);
        block.value    = Blockchain.blockNumber;
        this._lenderBlock.set(caller, block);

        const withdraw = u256.eq(amount, u256.Zero) ? deposited!.value : amount;
        assert(u256.le(withdraw, deposited!.value), 'Yetersiz bakiye');

        const available = u256.sub(this._totalLiquidity.value, this._totalBorrowed.value);
        assert(u256.le(withdraw, available), 'Yetersiz havuz likidite');

        const interest = accrued.value;

        // Bakiyeleri güncelle
        deposited!.value = u256.sub(deposited!.value, withdraw);
        this._lenderDeposited.set(caller, deposited!);
        accrued.value = u256.Zero;
        this._lenderAccrued.set(caller, accrued);
        this._totalLiquidity.value = u256.sub(this._totalLiquidity.value, withdraw);

        // ── Token transferi: kontrat → kullanıcı (anapara + faiz) ─────────────
        const loanToken = Address.fromU256(this._loanTokenAddr.value);
        const total     = u256.add(withdraw, interest);
        const ok        = op20Transfer(loanToken, caller, total);
        assert(ok, 'loanToken transfer basarisiz');

        this.emitEvent(new LiquidityWithdrawnEvent(caller, withdraw, interest));

        const res = new BytesWriter(64);
        res.writeU256(withdraw); res.writeU256(interest);
        return res;
    }

    // ─── Borrower: Teminat Yatır ──────────────────────────────────────────────

    /**
     * depositCollateral(amount: u256)
     *
     * Ön koşul: Kullanıcı → collateralToken.approve(lendingContract, amount) çağırmış olmalı
     */
    private _depositCollateral(calldata: Calldata): BytesWriter {
        const amount = calldata.readU256();
        assert(!u256.eq(amount, u256.Zero), 'Sifir teminat');

        const caller   = Blockchain.callerAddress;
        const self     = Blockchain.contractAddress;
        const colToken = Address.fromU256(this._colTokenAddr.value);

        // ── Allowance kontrolü ────────────────────────────────────────────────
        const allowance = op20Allowance(colToken, caller, self);
        assert(u256.ge(allowance, amount), 'Onay yetersiz: once collateralToken.approve() cagirin');

        // ── Token transferi: kullanıcı → kontrat ──────────────────────────────
        const ok = op20TransferFrom(colToken, caller, self, amount);
        assert(ok, 'collateralToken transferFrom basarisiz');

        // ── Teminatı kaydet ───────────────────────────────────────────────────
        const col = this._borrowerCol.getOrDefault(caller, u256.Zero);
        col.value = u256.add(col.value, amount);
        this._borrowerCol.set(caller, col);

        this.emitEvent(new CollateralDepositedEvent(caller, amount));
        return this._bool(true);
    }

    // ─── Borrower: Borçlan ────────────────────────────────────────────────────

    /**
     * borrow(loanAmount: u256, colPriceInLoanToken: u256)
     *
     * colPriceInLoanToken: 1 teminat tokeni kaç loan token?
     *                      (18 decimal hassasiyetinde, örn. 1e18 = eşit değer)
     */
    private _borrow(calldata: Calldata): BytesWriter {
        const loanAmount = calldata.readU256();
        const colPrice   = calldata.readU256();
        assert(!u256.eq(loanAmount, u256.Zero), 'Sifir borc');

        const caller = Blockchain.callerAddress;

        // Aktif borç yok mu?
        const active = this._borrowerActive.get(caller);
        assert(!active || !active.value, 'Aktif borc pozisyonu mevcut');

        // Teminat var mı?
        const col = this._borrowerCol.get(caller);
        assert(col !== null && !u256.eq(col!.value, u256.Zero), 'Once teminat yatirin');

        // Teminat değeri → loan token cinsinden
        const SCALE    = u256.fromU64(Config.SCALE);
        const colValue = u256.div(u256.mul(col!.value, colPrice), SCALE);

        // Maksimum borç = colValue * 100 / colRatio
        const maxBorrow = u256.div(
            u256.mul(colValue, u256.fromU64(100)),
            this._colRatioPct.value
        );
        assert(u256.le(loanAmount, maxBorrow), 'Yetersiz teminat: borc talep cok yuksek');

        // Havuz likiditesi yeterli mi?
        const avail = u256.sub(this._totalLiquidity.value, this._totalBorrowed.value);
        assert(u256.le(loanAmount, avail), 'Yetersiz havuz likidite');

        // Pozisyonu kaydet
        const debtStore = this._borrowerDebt.getOrDefault(caller, u256.Zero);
        debtStore.value = loanAmount;
        this._borrowerDebt.set(caller, debtStore);

        const blk = this._borrowerBlock.getOrDefault(caller, u256.Zero);
        blk.value = Blockchain.blockNumber;
        this._borrowerBlock.set(caller, blk);

        const act = this._borrowerActive.getOrDefault(caller, false);
        act.value = true;
        this._borrowerActive.set(caller, act);

        this._totalBorrowed.value = u256.add(this._totalBorrowed.value, loanAmount);

        // ── Token transferi: kontrat → borçlu ─────────────────────────────────
        const loanToken = Address.fromU256(this._loanTokenAddr.value);
        const ok        = op20Transfer(loanToken, caller, loanAmount);
        assert(ok, 'loanToken transfer basarisiz');

        this.emitEvent(new BorrowedEvent(caller, loanAmount, col!.value));

        const res = new BytesWriter(32);
        res.writeU256(loanAmount);
        return res;
    }

    // ─── Borrower: Geri Öde ───────────────────────────────────────────────────

    /**
     * repay()
     *
     * Ön koşul: Kullanıcı → loanToken.approve(lendingContract, totalDebt) çağırmış olmalı
     *           Toplam borç = anapara + faiz (getTotalDebt() ile sorgulanabilir)
     */
    private _repay(_calldata: Calldata): BytesWriter {
        const caller = Blockchain.callerAddress;
        const self   = Blockchain.contractAddress;

        const active = this._borrowerActive.get(caller);
        assert(active !== null && active!.value, 'Aktif borc yok');

        const debtStore = this._borrowerDebt.get(caller);
        const colStore  = this._borrowerCol.get(caller);

        const interest   = this._calcBorrowInterest(caller);
        const principal  = debtStore!.value;
        const totalDebt  = u256.add(principal, interest);
        const collateral = colStore!.value;

        // ── Allowance kontrolü ────────────────────────────────────────────────
        const loanToken = Address.fromU256(this._loanTokenAddr.value);
        const allowance = op20Allowance(loanToken, caller, self);
        assert(u256.ge(allowance, totalDebt), 'Onay yetersiz: once loanToken.approve(totalDebt) cagirin');

        // ── Token transferi: kullanıcı → kontrat (borç geri ödeme) ───────────
        const ok = op20TransferFrom(loanToken, caller, self, totalDebt);
        assert(ok, 'loanToken transferFrom (repay) basarisiz');

        // ── Pozisyonu kapat ───────────────────────────────────────────────────
        this._totalBorrowed.value = u256.sub(this._totalBorrowed.value, principal);
        debtStore!.value  = u256.Zero;
        colStore!.value   = u256.Zero;
        active!.value     = false;

        const blk = this._borrowerBlock.get(caller);
        if (blk) { blk.value = u256.Zero; this._borrowerBlock.set(caller, blk); }

        this._borrowerDebt.set(caller, debtStore!);
        this._borrowerCol.set(caller, colStore!);
        this._borrowerActive.set(caller, active!);

        // Faiz geliri havuzda kalır (totalLiquidity içinde), anapara zaten orada

        // ── Teminatı iade et: kontrat → kullanıcı ─────────────────────────────
        const colToken = Address.fromU256(this._colTokenAddr.value);
        const ok2      = op20Transfer(colToken, caller, collateral);
        assert(ok2, 'collateralToken transfer (repay) basarisiz');

        this.emitEvent(new RepaidEvent(caller, principal, interest));
        this.emitEvent(new CollateralWithdrawnEvent(caller, collateral));

        const res = new BytesWriter(64);
        res.writeU256(totalDebt); res.writeU256(collateral);
        return res;
    }

    // ─── Tasfiye ─────────────────────────────────────────────────────────────

    /**
     * liquidate(borrower: Address, colPriceInLoanToken: u256)
     *
     * Ön koşul: Tasfiyeci → loanToken.approve(lendingContract, totalDebt) çağırmış olmalı
     */
    private _liquidate(calldata: Calldata): BytesWriter {
        const borrower = calldata.readAddress();
        const colPrice = calldata.readU256();
        const liquidator = Blockchain.callerAddress;
        const self       = Blockchain.contractAddress;

        const active = this._borrowerActive.get(borrower);
        assert(active !== null && active!.value, 'Aktif borc yok');

        const debtStore = this._borrowerDebt.get(borrower);
        const colStore  = this._borrowerCol.get(borrower);

        const interest  = this._calcBorrowInterest(borrower);
        const totalDebt = u256.add(debtStore!.value, interest);

        // Teminat oranını kontrol et
        const SCALE    = u256.fromU64(Config.SCALE);
        const colValue = u256.div(u256.mul(colStore!.value, colPrice), SCALE);
        const ratio    = u256.div(u256.mul(colValue, u256.fromU64(100)), totalDebt);

        assert(u256.lt(ratio, this._liqThreshPct.value), 'Tasfiye esigi asilmadi');

        // Allowance kontrolü (tasfiyeci borcu öder)
        const loanToken = Address.fromU256(this._loanTokenAddr.value);
        const allowance = op20Allowance(loanToken, liquidator, self);
        assert(u256.ge(allowance, totalDebt), 'Onay yetersiz: once loanToken.approve(totalDebt) cagirin');

        // Tasfiyeci borcu öder: tasfiyeci → kontrat
        const ok = op20TransferFrom(loanToken, liquidator, self, totalDebt);
        assert(ok, 'loanToken transferFrom (liquidate) basarisiz');

        // Tasfiye bonusu hesapla
        const bonus          = u256.div(u256.mul(colStore!.value, this._liqBonusBps.value), u256.fromU64(Config.BPS));
        const collateralPayout = u256.add(colStore!.value, bonus);

        // Pozisyonu kapat
        this._totalBorrowed.value = u256.sub(this._totalBorrowed.value, debtStore!.value);
        debtStore!.value = u256.Zero;
        colStore!.value  = u256.Zero;
        active!.value    = false;

        this._borrowerDebt.set(borrower, debtStore!);
        this._borrowerCol.set(borrower, colStore!);
        this._borrowerActive.set(borrower, active!);

        // Teminat + bonus: kontrat → tasfiyeci
        const colToken = Address.fromU256(this._colTokenAddr.value);
        const ok2      = op20Transfer(colToken, liquidator, collateralPayout);
        assert(ok2, 'collateralToken transfer (liquidate) basarisiz');

        this.emitEvent(new LiquidatedEvent(borrower, liquidator, totalDebt, collateralPayout));

        const res = new BytesWriter(64);
        res.writeU256(totalDebt); res.writeU256(collateralPayout);
        return res;
    }

    // ─── Yönetici ────────────────────────────────────────────────────────────

    private _updateParameters(calldata: Calldata): BytesWriter {
        this._onlyOwner();

        const interestBps = calldata.readU64();
        const colRatio    = calldata.readU64();
        const liqThresh   = calldata.readU64();
        const liqBonus    = calldata.readU64();

        assert(colRatio > liqThresh, 'Teminat orani > tasfiye esigi olmali');

        this._interestBps.value  = u256.fromU64(interestBps);
        this._colRatioPct.value  = u256.fromU64(colRatio);
        this._liqThreshPct.value = u256.fromU64(liqThresh);
        this._liqBonusBps.value  = u256.fromU64(liqBonus);

        this.emitEvent(new ParametersUpdatedEvent(
            u256.fromU64(interestBps), u256.fromU64(colRatio),
            u256.fromU64(liqThresh),   u256.fromU64(liqBonus)
        ));

        return this._bool(true);
    }

    // ─── View Fonksiyonları ───────────────────────────────────────────────────

    private _getColRatio(calldata: Calldata): BytesWriter {
        const borrower = calldata.readAddress();
        const colPrice = calldata.readU256();

        const active = this._borrowerActive.get(borrower);
        if (!active || !active.value) {
            const r = new BytesWriter(32); r.writeU256(u256.Max); return r;
        }

        const debt    = u256.add(this._borrowerDebt.get(borrower)!.value, this._calcBorrowInterest(borrower));
        const SCALE   = u256.fromU64(Config.SCALE);
        const colVal  = u256.div(u256.mul(this._borrowerCol.get(borrower)!.value, colPrice), SCALE);
        const ratio   = u256.div(u256.mul(colVal, u256.fromU64(100)), debt);

        const r = new BytesWriter(32); r.writeU256(ratio); return r;
    }

    private _getTotalDebt(calldata: Calldata): BytesWriter {
        const borrower = calldata.readAddress();
        const active   = this._borrowerActive.get(borrower);
        const debt     = (!active || !active.value)
            ? u256.Zero
            : u256.add(this._borrowerDebt.get(borrower)!.value, this._calcBorrowInterest(borrower));

        const r = new BytesWriter(32); r.writeU256(debt); return r;
    }

    private _getPendingInterest(calldata: Calldata): BytesWriter {
        const lender  = calldata.readAddress();
        const accrued = this._lenderAccrued.get(lender);
        const pending = u256.add(
            this._calcLenderInterest(lender),
            accrued ? accrued.value : u256.Zero
        );
        const r = new BytesWriter(32); r.writeU256(pending); return r;
    }

    private _utilizationRate(): BytesWriter {
        const liq  = this._totalLiquidity.value;
        const rate = u256.eq(liq, u256.Zero)
            ? u256.Zero
            : u256.div(u256.mul(this._totalBorrowed.value, u256.fromU64(Config.BPS)), liq);

        const r = new BytesWriter(32); r.writeU256(rate); return r;
    }

    private _getLenderInfo(calldata: Calldata): BytesWriter {
        const lender   = calldata.readAddress();
        const dep      = this._lenderDeposited.get(lender);
        const blk      = this._lenderBlock.get(lender);
        const accrued  = this._lenderAccrued.get(lender);
        const pending  = this._calcLenderInterest(lender);

        const r = new BytesWriter(128);
        r.writeU256(dep     ? dep.value    : u256.Zero);
        r.writeU256(blk     ? blk.value    : u256.Zero);
        r.writeU256(accrued ? u256.add(accrued.value, pending) : pending);
        return r;
    }

    private _getBorrowerPos(calldata: Calldata): BytesWriter {
        const borrower = calldata.readAddress();
        const col      = this._borrowerCol.get(borrower);
        const debt     = this._borrowerDebt.get(borrower);
        const blk      = this._borrowerBlock.get(borrower);
        const active   = this._borrowerActive.get(borrower);
        const interest = this._calcBorrowInterest(borrower);

        const r = new BytesWriter(129);
        r.writeU256(col    ? col.value    : u256.Zero);
        r.writeU256(debt   ? u256.add(debt.value, interest) : u256.Zero);
        r.writeU256(blk    ? blk.value    : u256.Zero);
        r.writeBoolean(active ? active.value : false);
        return r;
    }

    /**
     * checkAllowance(tokenType: u8, owner: Address)
     *   tokenType: 0 = loanToken, 1 = collateralToken
     * Kullanıcının kontrata verdiği allowance'ı döndürür
     */
    private _checkAllowance(calldata: Calldata): BytesWriter {
        const tokenType = calldata.readU8();
        const owner     = calldata.readAddress();
        const self      = Blockchain.contractAddress;

        const tokenAddr = tokenType === 0
            ? Address.fromU256(this._loanTokenAddr.value)
            : Address.fromU256(this._colTokenAddr.value);

        const allowance = op20Allowance(tokenAddr, owner, self);

        const r = new BytesWriter(32); r.writeU256(allowance); return r;
    }

    // ─── İç Yardımcı Fonksiyonlar ────────────────────────────────────────────

    private _calcBorrowInterest(borrower: Address): u256 {
        const active = this._borrowerActive.get(borrower);
        if (!active || !active.value) return u256.Zero;

        const debt = this._borrowerDebt.get(borrower);
        const blk  = this._borrowerBlock.get(borrower);
        if (!debt || !blk) return u256.Zero;

        const current = Blockchain.blockNumber;
        if (u256.le(current, blk.value)) return u256.Zero;

        const elapsed = u256.sub(current, blk.value);
        const num     = u256.mul(u256.mul(debt.value, this._interestBps.value), elapsed);
        const den     = u256.fromU64(Config.BLOCKS_PER_YEAR * Config.BPS);
        return u256.div(num, den);
    }

    private _calcLenderInterest(lender: Address): u256 {
        const dep = this._lenderDeposited.get(lender);
        const blk = this._lenderBlock.get(lender);
        if (!dep || u256.eq(dep.value, u256.Zero)) return u256.Zero;
        if (!blk || u256.eq(blk.value, u256.Zero)) return u256.Zero;

        const current = Blockchain.blockNumber;
        if (u256.le(current, blk.value)) return u256.Zero;

        const elapsed     = u256.sub(current, blk.value);
        const liq         = this._totalLiquidity.value;
        const utilization = u256.eq(liq, u256.Zero)
            ? u256.Zero
            : u256.div(u256.mul(this._totalBorrowed.value, u256.fromU64(Config.BPS)), liq);

        const num = u256.mul(u256.mul(u256.mul(dep.value, this._interestBps.value), utilization), elapsed);
        const den = u256.fromU64(Config.BLOCKS_PER_YEAR * Config.BPS * Config.BPS);
        return u256.div(num, den);
    }

    private _onlyOwner(): void {
        assert(u256.eq(Blockchain.callerAddress.toU256(), this._owner.value), 'Yetkisiz erisim');
    }

    private _bool(value: bool): BytesWriter {
        const r = new BytesWriter(1); r.writeBoolean(value); return r;
    }
}
