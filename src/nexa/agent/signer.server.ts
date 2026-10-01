import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bigToBytes, fromHex, keccak, rlp, toHex, type Hex } from "../providers/eth.server";

/**
 * Server-only signer. The secret is read inside these functions only and never returned, logged or serialized.
 * Accepted secret names, in order: NEXA_PRIVATE_KEY, NEXA_SIGNER_PRIVATE_KEY.
 */
const SECRET_NAMES = ["NEXA_PRIVATE_KEY", "NEXA_SIGNER_PRIVATE_KEY"] as const;
function readSecret(): { name: (typeof SECRET_NAMES)[number]; key: Uint8Array } | { name: (typeof SECRET_NAMES)[number]; key: null } | null {
  for (const name of SECRET_NAMES) {
    const raw = process.env[name]?.trim();
    if (!raw) continue;
    const normalized = raw.replace(/^0x/i, "");
    return /^[0-9a-fA-F]{64}$/.test(normalized) ? { name, key: fromHex(normalized) } : { name, key: null };
  }
  return null;
}
const addressOf = (key: Uint8Array): Hex => toHex(keccak(secp256k1.getPublicKey(key, false).slice(1)).slice(-20));

export interface SignerStatus { present: boolean; valid: boolean; secretName?: string; address?: Hex }
/** Safe metadata only: presence, format validity, and the derived PUBLIC address. */
export function signerStatus(): SignerStatus {
  const secret = readSecret();
  if (!secret) return { present: false, valid: false };
  if (!secret.key) return { present: true, valid: false, secretName: secret.name };
  try { return { present: true, valid: true, secretName: secret.name, address: addressOf(secret.key) }; }
  catch { return { present: true, valid: false, secretName: secret.name }; }
}

export interface LegacyTx { nonce: bigint; gasPrice: bigint; gas: bigint; to: Hex; value: bigint; data: Hex }
/** EIP-155 legacy signing for chainId 56. Returns only the raw signed transaction. */
export function signLegacyTransaction(tx: LegacyTx, chainId = 56n): Hex {
  const secret = readSecret();
  if (!secret?.key) throw new Error("SIGNER_UNAVAILABLE");
  const fields = [bigToBytes(tx.nonce), bigToBytes(tx.gasPrice), bigToBytes(tx.gas), fromHex(tx.to), bigToBytes(tx.value), fromHex(tx.data)];
  const hash = keccak(rlp([...fields, bigToBytes(chainId), new Uint8Array(), new Uint8Array()]));
  const signature = secp256k1.sign(hash, secret.key, { prehash: false, format: "recovered" });
  const recovery = BigInt(signature[0] ?? 0);
  const strip = (bytes: Uint8Array) => { let index = 0; while (index < bytes.length && bytes[index] === 0) index += 1; return bytes.slice(index); };
  return toHex(rlp([...fields, bigToBytes(recovery + chainId * 2n + 35n), strip(signature.slice(1, 33)), strip(signature.slice(33, 65))]));
}
