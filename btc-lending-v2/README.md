# 🔶 BTCLendingProtocol v2 — Tam OP_20 Token Akışı

OP_NET üzerinde AssemblyScript ile yazılmış, **gerçek OP_20 token transferleri** içeren Bitcoin borç verme protokolü.

---

## 🔄 Token Akış Diyagramı

```
┌─────────────┐     approve(lending, amount)     ┌──────────────┐
│   Kullanıcı │ ───────────────────────────────► │  loanToken   │
│   (Lender)  │                                  │   (OP_20)    │
│             │◄─────── transfer(lender, ─────── │              │
│             │         principal+interest)       └──────────────┘
└─────────────┘
       │  depositLiquidity(amount)
       ▼
┌─────────────────────────────────────────────────────────┐
│                   BTCLendingProtocol                    │
│                                                         │
│  transferFrom(lender → self)  ── likidite yatırılır     │
│  transfer(self → lender)      ── likidite + faiz çekilir│
│  transferFrom(borrower → self) ─ teminat kilitlenir     │
│  transfer(self → borrower)    ── borç verilir           │
│  transferFrom(borrower → self) ─ borç geri alınır       │
│  transfer(self → borrower)    ── teminat iade edilir    │
└─────────────────────────────────────────────────────────┘
       │  depositCollateral + borrow
       ▼
┌─────────────┐    approve(lending, collateral)  ┌───────────────────┐
│   Kullanıcı │ ─────────────────────────────► │  collateralToken  │
│  (Borrower) │                                  │     (OP_20)       │
│             │◄───── transfer(borrower, ──────── │                   │
│             │       collateral)                 └───────────────────┘
└─────────────┘
```

---

## 📋 İşlem Akışları (Adım Adım)

### Lender: Likidite Yatır
```typescript
// 1. Önce izin ver
await loanToken.approve(lendingContractAddress, amount);

// 2. Sonra yatır
await lending.depositLiquidity(amount);
// → Kontrat içinde: loanToken.transferFrom(caller, self, amount) çağrılır
```

### Lender: Likidite Çek
```typescript
// Approve gerekmez (kontrat gönderiyor)
await lending.withdrawLiquidity(0n);  // 0 = tamamını çek
// → loanToken.transfer(caller, anapara + faiz) çağrılır
```

### Borrower: Teminat Yatır
```typescript
// 1. Önce izin ver
await collateralToken.approve(lendingContractAddress, collateralAmount);

// 2. Yatır
await lending.depositCollateral(collateralAmount);
// → collateralToken.transferFrom(caller, self, amount) çağrılır
```

### Borrower: Borçlan
```typescript
// Approve gerekmez (kontrat loan token gönderiyor)
// colPrice: 1 teminat tokeni = kaç loan token? (1e18 = eşit değer)
await lending.borrow(loanAmount, BigInt(1e18));
// → loanToken.transfer(caller, loanAmount) çağrılır
```

### Borrower: Geri Öde
```typescript
// 1. Toplam borcu öğren
const { result: totalDebt } = await lending.getTotalDebt(myAddress);

// 2. Önce izin ver (totalDebt kadar)
await loanToken.approve(lendingContractAddress, totalDebt);

// 3. Geri öde
await lending.repay();
// → loanToken.transferFrom(caller, self, totalDebt) // borç alınır
// → collateralToken.transfer(caller, collateral)    // teminat iade edilir
```

### Tasfiye
```typescript
// Tasfiye edilebilir pozisyonları bul (getCollateralRatio < 120)
const { result: ratio } = await lending.getCollateralRatio(borrower, currentPrice);

if (ratio < 120n) {
    // 1. Toplam borcu öğren
    const { result: debt } = await lending.getTotalDebt(borrower);

    // 2. Approve
    await loanToken.approve(lendingContractAddress, debt);

    // 3. Tasfiye et (teminat + %5 bonus alırsın)
    await lending.liquidate(borrower, currentPrice);
}
```

---

## 🚀 Kurulum ve Dağıtım

### 1. Bağımlılıkları Yükle
```bash
npm install
```

### 2. Derle
```bash
npm run build
# Çıktı: build/contract.wasm
```

### 3. OP_20 Token Kontratları Dağıt (eğer yoksa)
Önce [OP_20 örneğinden](https://github.com/btc-vision/OP_20) loan token ve collateral token kontratlarını dağıtın.

### 4. Lending Protokolünü Dağıt
```bash
export WALLET_WIF="cQz..."
export LOAN_TOKEN_ADDRESS="bcrt1p..."       # loanToken kontrat adresi
export COLLATERAL_TOKEN_ADDRESS="bcrt1p..."  # collateralToken kontrat adresi
export NETWORK="regtest"
export RPC_URL="https://regtest.opnet.org"

npm run deploy
```

Script otomatik olarak:
- Protokolü dağıtır
- Likidite yatırır (approve → deposit)
- Teminat yatırır (approve → deposit)
- Borçlanır
- Geri öder (approve → repay)
- Likiditeyi çeker

---

## ⚙️ Protokol Parametreleri

| Parametre | Varsayılan | Açıklama |
|---|---|---|
| `annualInterestBps` | 500 (%5) | Yıllık faiz |
| `collateralRatioPct` | 150 (%150) | Min teminat oranı |
| `liquidationThresholdPct` | 120 (%120) | Tasfiye eşiği |
| `liquidationBonusBps` | 500 (%5) | Tasfiyeci bonusu |

---

## 🔐 Güvenlik Mimarisi

### Approve Önce, İşlem Sonra
Her token transferi **iki aşamalıdır:**
1. Kullanıcı OP_20 kontratında `approve()` çağırır
2. Lending kontratı `transferFrom()` ile token alır

Bu, Solidity ERC-20 ile aynı güvenlik modelidir ve **reentrancy saldırılarını** önler.

### Allowance Kontrolü
Kontrat, `transferFrom` çağrısından önce `allowance()` ile yeterli izin olup olmadığını kontrol eder. Yetersizse işlem iptal edilir.

### Bitcoin Native Kısıtlaması
OP_NET'te kontratlar doğrudan BTC tutamaz. Bunun yerine OP_20 wrapper token kullanılır. Bu tasarım, Bitcoin'in UTXO modeliyle uyumludur.

---

## 📚 Kaynaklar
- [OP_NET](https://opnet.org)
- [btc-runtime](https://github.com/btc-vision/btc-runtime)
- [OP_20 Standardı](https://github.com/btc-vision/OP_20)
- [opnet SDK](https://github.com/btc-vision/opnet)
