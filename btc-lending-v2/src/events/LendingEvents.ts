import { Address, BytesWriter, NetEvent } from '@btc-vision/btc-runtime/runtime';
import { u256 } from 'as-bignum/assembly';

export class LiquidityDepositedEvent extends NetEvent {
    constructor(lender: Address, amount: u256) {
        const w = new BytesWriter(64);
        w.writeAddress(lender); w.writeU256(amount);
        super('LiquidityDeposited', w);
    }
}

export class LiquidityWithdrawnEvent extends NetEvent {
    constructor(lender: Address, principal: u256, interest: u256) {
        const w = new BytesWriter(96);
        w.writeAddress(lender); w.writeU256(principal); w.writeU256(interest);
        super('LiquidityWithdrawn', w);
    }
}

export class CollateralDepositedEvent extends NetEvent {
    constructor(borrower: Address, amount: u256) {
        const w = new BytesWriter(64);
        w.writeAddress(borrower); w.writeU256(amount);
        super('CollateralDeposited', w);
    }
}

export class CollateralWithdrawnEvent extends NetEvent {
    constructor(borrower: Address, amount: u256) {
        const w = new BytesWriter(64);
        w.writeAddress(borrower); w.writeU256(amount);
        super('CollateralWithdrawn', w);
    }
}

export class BorrowedEvent extends NetEvent {
    constructor(borrower: Address, loanAmount: u256, collateral: u256) {
        const w = new BytesWriter(96);
        w.writeAddress(borrower); w.writeU256(loanAmount); w.writeU256(collateral);
        super('Borrowed', w);
    }
}

export class RepaidEvent extends NetEvent {
    constructor(borrower: Address, principal: u256, interest: u256) {
        const w = new BytesWriter(96);
        w.writeAddress(borrower); w.writeU256(principal); w.writeU256(interest);
        super('Repaid', w);
    }
}

export class LiquidatedEvent extends NetEvent {
    constructor(borrower: Address, liquidator: Address, debt: u256, collateralSeized: u256) {
        const w = new BytesWriter(128);
        w.writeAddress(borrower); w.writeAddress(liquidator);
        w.writeU256(debt); w.writeU256(collateralSeized);
        super('Liquidated', w);
    }
}

export class ParametersUpdatedEvent extends NetEvent {
    constructor(interestBps: u256, colRatio: u256, liqThresh: u256, liqBonus: u256) {
        const w = new BytesWriter(128);
        w.writeU256(interestBps); w.writeU256(colRatio);
        w.writeU256(liqThresh); w.writeU256(liqBonus);
        super('ParametersUpdated', w);
    }
}
