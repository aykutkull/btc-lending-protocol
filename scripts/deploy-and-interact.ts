/**
 * deploy-and-interact.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * BTCLendingProtocol v2'yi OP_NET regtest'e dağıtır ve token akışını test eder.
 *
 * Kullanım:
 *   npx ts-node scripts/deploy-and-interact.ts
 *
 * Ortam değişkenleri:
 *   WALLET_WIF            = cQz...   (Bitcoin WIF private key)
 *   LOAN_TOKEN_ADDRESS    = bcrt1p...  (OP_20 loan token kontrat adresi)
 *   COLLATERAL_TOKEN_ADDRESS = bcrt1p... (OP_20 collateral token kontrat adresi)
 *   NETWORK               = regtest | testnet | mainnet
 *   RPC_URL               = https://regtest.opnet.org
 */

import {
    getContract,
    IOP20Contract,
    JSONRpcProvider,
    OP_20_ABI,
} from 'opnet';
import { Address, Wallet }  from '@btc-vision/transaction';
import { Network, networks } from '@btc-vision/bitcoin';
import * as fs               from 'fs';
import * as path             from 'path';

// ─── Yapılandırma ────────────────────────────────────────────────────────────

const NETWORK_NAME           = process.env.NETWORK    || 'regtest';
const RPC_URL                = process.env.RPC_URL     || 'https://regtest.opnet.org';
const WALLET_WIF             = process.env.WALLET_WIF  || '';
const LOAN_TOKEN_ADDR        = process.env.LOAN_TOKEN_ADDRESS         || '';
const COLLATERAL_TOKEN_ADDR  = process.env.COLLATERAL_TOKEN_ADDRESS   || '';

// Protokol parametreleri
const PARAMS = {
    annualInterestBps  : 500n,   // %5 yıllık
    collateralRatioPct : 150n,   // %150 min teminat oranı
    liquidationThresh  : 120n,   // %120 tasfiye eşiği
    liquidationBonus   : 500n,   // %5 tasfiye bonusu
};

function getNetwork(n: string): Network {
    return n === 'mainnet' ? networks.bitcoin : n === 'testnet' ? networks.testnet : networks.regtest;
}

// ─── Lending Kontrat ABI ─────────────────────────────────────────────────────

const LENDING_ABI = [
    { name: 'onDeployment',       inputs: [
        { type: 'address' }, { type: 'address' },
        { type: 'uint64' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint64' }
    ]},
    { name: 'depositLiquidity',   inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] },
    { name: 'withdrawLiquidity',  inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
    { name: 'depositCollateral',  inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] },
    { name: 'borrow',             inputs: [{ type: 'uint256' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }] },
    { name: 'repay',              inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
    { name: 'liquidate',          inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
    { name: 'getTotalDebt',       inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
    { name: 'getCollateralRatio', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }] },
    { name: 'utilizationRate',    inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'checkAllowance',     inputs: [{ type: 'uint8' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
];

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`  ${msg}`); }
function section(title: string) {
    console.log(`\n${'─'.repeat(55)}`);
    console.log(`  ${title}`);
    console.log('─'.repeat(55));
}

function formatAmount(n: bigint, decimals = 8): string {
    const factor = BigInt(10 ** decimals);
    const whole  = n / factor;
    const frac   = n % factor;
    return `${whole}.${frac.toString().padStart(decimals, '0')} (${n} raw)`;
}

// ─── Ana Akış ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    if (!WALLET_WIF)            throw new Error('WALLET_WIF ayarlanmamış');
    if (!LOAN_TOKEN_ADDR)       throw new Error('LOAN_TOKEN_ADDRESS ayarlanmamış');
    if (!COLLATERAL_TOKEN_ADDR) throw new Error('COLLATERAL_TOKEN_ADDRESS ayarlanmamış');

    const network = getNetwork(NETWORK_NAME);
    const provider = new JSONRpcProvider(RPC_URL, network);
    const wallet   = Wallet.fromWIF(WALLET_WIF, network);
    const myAddr   = new Address(wallet.keypair.publicKey);

    section('🚀 BTCLendingProtocol v2 Dağıtımı');
    log(`Cüzdan : ${myAddr.toString()}`);
    log(`Ağ     : ${NETWORK_NAME}`);
    log(`RPC    : ${RPC_URL}`);

    // WASM yükle
    const wasmPath = path.resolve(__dirname, '../build/contract.wasm');
    if (!fs.existsSync(wasmPath)) throw new Error(`WASM bulunamadı: ${wasmPath} — npm run build çalıştırın`);
    const wasm = fs.readFileSync(wasmPath);
    log(`WASM   : ${wasm.length} byte`);

    // Dağıtım calldata
    const deployCalldata = encodeDeployCalldata(
        LOAN_TOKEN_ADDR, COLLATERAL_TOKEN_ADDR,
        PARAMS.annualInterestBps, PARAMS.collateralRatioPct,
        PARAMS.liquidationThresh, PARAMS.liquidationBonus
    );

    log('\nDağıtım gönderiliyor...');
    const { ContractDeployment } = await import('opnet');
    const deployment = new ContractDeployment({ provider, wallet, bytecode: wasm, calldata: deployCalldata, network });
    const result     = await deployment.deploy();

    const lendingAddr = result.contractAddress;
    log(`✅ Kontrat: ${lendingAddr}`);
    log(`   Txid  : ${result.txid}`);

    // Kontrat nesneleri
    const lending   = getContract(lendingAddr, LENDING_ABI, provider, network, myAddr);
    const loanTk    = getContract<IOP20Contract>(LOAN_TOKEN_ADDR,       OP_20_ABI, provider, network, myAddr);
    const colTk     = getContract<IOP20Contract>(COLLATERAL_TOKEN_ADDR, OP_20_ABI, provider, network, myAddr);

    // ────────────────────────────────────────────────────────────────
    // ADIM 1: Ödünç Veren → Likidite Yatır
    // ────────────────────────────────────────────────────────────────
    section('📥 Adım 1: Likidite Yatır (Lender)');

    const LIQUIDITY = 10_000_000n;  // 0.1 BTC (8 decimal)
    log(`Miktar : ${formatAmount(LIQUIDITY)}`);

    // 1a. Önce approve
    log('loanToken.approve() çağrılıyor...');
    await loanTk.approve(new Address(Buffer.from(lendingAddr)), LIQUIDITY);
    log('✅ Approve başarılı');

    // 1b. Sonra depositLiquidity
    log('lending.depositLiquidity() çağrılıyor...');
    await lending.depositLiquidity(LIQUIDITY);
    log('✅ Likidite yatırıldı');

    // ────────────────────────────────────────────────────────────────
    // ADIM 2: Borçlu → Teminat Yatır
    // ────────────────────────────────────────────────────────────────
    section('🔒 Adım 2: Teminat Yatır (Borrower)');

    const COLLATERAL = 5_000_000n;  // 0.05 BTC teminat
    log(`Miktar : ${formatAmount(COLLATERAL)}`);

    // 2a. Approve
    log('collateralToken.approve() çağrılıyor...');
    await colTk.approve(new Address(Buffer.from(lendingAddr)), COLLATERAL);
    log('✅ Approve başarılı');

    // 2b. depositCollateral
    log('lending.depositCollateral() çağrılıyor...');
    await lending.depositCollateral(COLLATERAL);
    log('✅ Teminat yatırıldı');

    // ────────────────────────────────────────────────────────────────
    // ADIM 3: Borçlu → Borçlan
    // ────────────────────────────────────────────────────────────────
    section('💸 Adım 3: Borçlan');

    // Teminat oranı %150 → max borç = collateral * (100/150) ≈ 3.333.333 sat
    const LOAN_AMOUNT = 3_000_000n;
    const COL_PRICE   = BigInt(1e18);  // 1:1 fiyat oranı (18 decimal)
    log(`Borç miktarı   : ${formatAmount(LOAN_AMOUNT)}`);
    log(`Teminat/fiyat  : 1:1 (${COL_PRICE})`);

    log('lending.borrow() çağrılıyor...');
    await lending.borrow(LOAN_AMOUNT, COL_PRICE);
    log('✅ Borç alındı');

    // Teminat oranını göster
    const ratioRes = await lending.getCollateralRatio(myAddr, COL_PRICE);
    log(`Teminat oranı  : %${ratioRes.properties[0]}`);

    // ────────────────────────────────────────────────────────────────
    // ADIM 4: Havuz kullanım oranı
    // ────────────────────────────────────────────────────────────────
    section('📊 Havuz Durumu');

    const utilRes = await lending.utilizationRate();
    const utilBps = utilRes.properties[0] as bigint;
    log(`Kullanım oranı : ${Number(utilBps) / 100}%`);

    // ────────────────────────────────────────────────────────────────
    // ADIM 5: Borcu Geri Öde
    // ────────────────────────────────────────────────────────────────
    section('💳 Adım 4: Borcu Geri Öde');

    // Toplam borcu sorgula
    const debtRes   = await lending.getTotalDebt(myAddr);
    const totalDebt = debtRes.properties[0] as bigint;
    log(`Toplam borç    : ${formatAmount(totalDebt)} (faiz dahil)`);

    // 5a. Approve (totalDebt kadar)
    log('loanToken.approve(totalDebt) çağrılıyor...');
    await loanTk.approve(new Address(Buffer.from(lendingAddr)), totalDebt);
    log('✅ Approve başarılı');

    // 5b. Repay
    log('lending.repay() çağrılıyor...');
    const repayRes = await lending.repay();
    log(`✅ Geri ödendi: ${formatAmount(repayRes.properties[0] as bigint)}`);
    log(`   Teminat iade: ${formatAmount(repayRes.properties[1] as bigint)}`);

    // ────────────────────────────────────────────────────────────────
    // ADIM 6: Likiditeyi çek (ödünç veren)
    // ────────────────────────────────────────────────────────────────
    section('📤 Adım 5: Likiditeyi Çek (Lender)');

    log('lending.withdrawLiquidity(0) çağrılıyor (tamamını çek)...');
    const withdrawRes = await lending.withdrawLiquidity(0n);
    log(`✅ Çekilen    : ${formatAmount(withdrawRes.properties[0] as bigint)}`);
    log(`   Faiz geliri: ${formatAmount(withdrawRes.properties[1] as bigint)}`);

    // ────────────────────────────────────────────────────────────────
    // Sonuç
    // ────────────────────────────────────────────────────────────────
    section('✅ Tüm İşlemler Başarılı!');
    log(`Kontrat: ${lendingAddr}`);
    log('Deployment bilgileri deployment.json dosyasına kaydedildi.');

    fs.writeFileSync(
        path.resolve(__dirname, '../deployment.json'),
        JSON.stringify({ contractAddress: lendingAddr, txid: result.txid, network: NETWORK_NAME, tokens: { loan: LOAN_TOKEN_ADDR, collateral: COLLATERAL_TOKEN_ADDR }, params: PARAMS, deployedAt: new Date().toISOString() }, null, 2)
    );
}

// ─── Calldata Kodlama ────────────────────────────────────────────────────────

function encodeDeployCalldata(
    loanToken: string, colToken: string,
    interestBps: bigint, colRatio: bigint,
    liqThresh: bigint, liqBonus: bigint
): Buffer {
    // 2 × Address (32 byte) + 4 × u64 (8 byte) = 96 byte
    const buf = Buffer.alloc(96);
    // Adresler: bech32 → 32 byte (xOnly pubkey)
    const loanBuf = Buffer.from(loanToken.replace('bcrt1p', ''), 'hex').slice(0, 32);
    const colBuf  = Buffer.from(colToken.replace('bcrt1p', ''),  'hex').slice(0, 32);
    loanBuf.copy(buf, 0);
    colBuf.copy(buf, 32);
    buf.writeBigUInt64BE(interestBps, 64);
    buf.writeBigUInt64BE(colRatio,    72);
    buf.writeBigUInt64BE(liqThresh,   80);
    buf.writeBigUInt64BE(liqBonus,    88);
    return buf;
}

main().catch(err => { console.error('\n❌ Hata:', err.message); process.exit(1); });
