import { keccak_256 } from "@noble/hashes/sha3.js";

export type Hex = `0x${string}`;
export const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString("hex")}`;
export const fromHex = (value: string) => { const raw = value.replace(/^0x/, ""); return Uint8Array.from(Buffer.from(raw.length % 2 ? `0${raw}` : raw, "hex")); };
export const keccak = (bytes: Uint8Array) => keccak_256(bytes);
export const selector = (signature: string) => toHex(keccak_256(new TextEncoder().encode(signature))).slice(0, 10);
export const padAddress = (address: string) => address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
export const padUint = (value: bigint) => value.toString(16).padStart(64, "0");
export const word = (data: string, index: number) => data.slice(2 + index * 64, 2 + (index + 1) * 64);
export const wordAddress = (data: string, index: number): Hex => `0x${word(data, index).slice(24)}`;
export const wordBig = (data: string, index: number) => { const value = word(data, index); return value ? BigInt(`0x${value}`) : 0n; };
export const topicAddress = (topic: string | undefined): Hex | undefined => (topic ? `0x${topic.slice(26)}` : undefined);
export const bigToBytes = (value: bigint) => (value === 0n ? new Uint8Array() : fromHex(value.toString(16)));
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type RlpInput = Uint8Array | RlpInput[];
function lengthPrefix(length: number, offset: number) {
  if (length < 56) return Uint8Array.of(offset + length);
  const lenBytes = bigToBytes(BigInt(length));
  return Uint8Array.of(offset + 55 + lenBytes.length, ...lenBytes);
}
/** Minimal RLP encoder for legacy EIP-155 transactions. */
export function rlp(input: RlpInput): Uint8Array {
  if (input instanceof Uint8Array) {
    if (input.length === 1 && (input[0] ?? 0) < 0x80) return input;
    return Uint8Array.of(...lengthPrefix(input.length, 0x80), ...input);
  }
  const body = input.map(rlp);
  const total = body.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(lengthPrefix(total, 0xc0).length + total);
  const prefix = lengthPrefix(total, 0xc0); out.set(prefix, 0);
  let cursor = prefix.length; for (const part of body) { out.set(part, cursor); cursor += part.length; }
  return out;
}
