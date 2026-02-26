/**
 * StoragePointers.ts — Kalıcı depolama pointer sabitleri
 */

export namespace Ptr {
    // ─── Protokol Yapılandırması ──────────────────────────────────────────────
    export const ANNUAL_INTEREST_BPS     : u16 = 1;
    export const COLLATERAL_RATIO_PCT    : u16 = 2;
    export const LIQUIDATION_THRESH_PCT  : u16 = 3;
    export const LIQUIDATION_BONUS_BPS   : u16 = 4;
    export const TOTAL_LIQUIDITY         : u16 = 5;
    export const TOTAL_BORROWED          : u16 = 6;
    export const OWNER                   : u16 = 7;
    export const LOAN_TOKEN_ADDR         : u16 = 8;   // loanToken adresi (u256 olarak saklanır)
    export const COLLATERAL_TOKEN_ADDR   : u16 = 9;   // collateralToken adresi

    // ─── Lender Verileri (sub-pointer = lender adresi) ────────────────────────
    export const LENDER_DEPOSITED        : u16 = 10;
    export const LENDER_DEPOSIT_BLOCK    : u16 = 11;
    export const LENDER_ACCRUED_INTEREST : u16 = 12;

    // ─── Borrower Verileri (sub-pointer = borrower adresi) ────────────────────
    export const BORROWER_COLLATERAL     : u16 = 20;
    export const BORROWER_DEBT          : u16 = 21;
    export const BORROWER_BORROW_BLOCK  : u16 = 22;
    export const BORROWER_ACTIVE        : u16 = 23;
}

export namespace Config {
    /** 1 yıl ≈ 52560 Bitcoin bloğu (10 dk/blok) */
    export const BLOCKS_PER_YEAR: u64 = 52_560;

    /** Basis points tabanı (10_000 = %100) */
    export const BPS: u64 = 10_000;

    /** Hassasiyet faktörü — overflow'u önlemek için ara hesaplarda kullanılır */
    export const SCALE: u64 = 1_000_000;
}
