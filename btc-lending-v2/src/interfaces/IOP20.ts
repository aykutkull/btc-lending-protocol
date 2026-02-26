/**
 * IOP20.ts — OP_20 Token Arayüzü
 *
 * OP_NET'te başka bir kontratı çağırmak için önce onun ABI'sini (selector + calldata)
 * bilmeniz gerekir. Bu dosya, OP_20 standart fonksiyonlarını çağırmak için
 * gerekli selector'ları ve yardımcı fonksiyonları tanımlar.
 *
 * OP_NET'te harici kontrat çağrısı: Blockchain.call(contractAddress, selector, calldata)
 */

import {
    Address,
    Blockchain,
    BytesWriter,
    encodeSelector,
} from '@btc-vision/btc-runtime/runtime';
import { u256 } from 'as-bignum/assembly';

// ─── OP_20 Fonksiyon Selektörleri ────────────────────────────────────────────

export namespace OP20Selector {
    export const TRANSFER_FROM = encodeSelector('transferFrom');
    export const TRANSFER      = encodeSelector('transfer');
    export const APPROVE       = encodeSelector('approve');
    export const BALANCE_OF    = encodeSelector('balanceOf');
    export const ALLOWANCE     = encodeSelector('allowance');
}

// ─── OP_20 Çağrı Yardımcıları ────────────────────────────────────────────────

/**
 * Harici OP_20 kontratında transferFrom çağırır.
 * Kullanıcı, lending kontratını önceden approve etmiş olmalıdır.
 *
 * @param tokenAddress  OP_20 kontrat adresi
 * @param from          Gönderen (approve etmiş kullanıcı)
 * @param to            Alıcı
 * @param amount        Miktar
 * @returns             İşlem başarılı mı?
 */
export function op20TransferFrom(
    tokenAddress: Address,
    from: Address,
    to: Address,
    amount: u256
): bool {
    const calldata = new BytesWriter(96);
    calldata.writeAddress(from);
    calldata.writeAddress(to);
    calldata.writeU256(amount);

    const result = Blockchain.call(tokenAddress, OP20Selector.TRANSFER_FROM, calldata);
    if (!result || result.byteLength < 1) return false;

    // OP_20 transfer: ilk byte bool döner
    return result[0] === 1;
}

/**
 * Harici OP_20 kontratında transfer çağırır.
 * Kontratın kendisi gönderiyor (lending → kullanıcı).
 *
 * @param tokenAddress  OP_20 kontrat adresi
 * @param to            Alıcı
 * @param amount        Miktar
 */
export function op20Transfer(
    tokenAddress: Address,
    to: Address,
    amount: u256
): bool {
    const calldata = new BytesWriter(64);
    calldata.writeAddress(to);
    calldata.writeU256(amount);

    const result = Blockchain.call(tokenAddress, OP20Selector.TRANSFER, calldata);
    if (!result || result.byteLength < 1) return false;

    return result[0] === 1;
}

/**
 * Kullanıcının belirli bir spender için verdiği allowance'ı sorgular.
 *
 * @param tokenAddress  OP_20 kontrat adresi
 * @param owner         Token sahibi
 * @param spender       Harcama yetkisi verilen adres
 * @returns             İzin verilen miktar
 */
export function op20Allowance(
    tokenAddress: Address,
    owner: Address,
    spender: Address
): u256 {
    const calldata = new BytesWriter(64);
    calldata.writeAddress(owner);
    calldata.writeAddress(spender);

    const result = Blockchain.call(tokenAddress, OP20Selector.ALLOWANCE, calldata);
    if (!result || result.byteLength < 32) return u256.Zero;

    // u256 = 32 byte big-endian
    return u256.fromBytes(result.slice(0, 32), true);
}

/**
 * Kullanıcının token bakiyesini sorgular.
 *
 * @param tokenAddress  OP_20 kontrat adresi
 * @param account       Sorgulanacak hesap
 * @returns             Bakiye
 */
export function op20BalanceOf(
    tokenAddress: Address,
    account: Address
): u256 {
    const calldata = new BytesWriter(32);
    calldata.writeAddress(account);

    const result = Blockchain.call(tokenAddress, OP20Selector.BALANCE_OF, calldata);
    if (!result || result.byteLength < 32) return u256.Zero;

    return u256.fromBytes(result.slice(0, 32), true);
}
