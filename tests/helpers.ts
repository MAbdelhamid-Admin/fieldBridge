import { expect } from "vitest";
import { FieldbridgeError, type FieldbridgeErrorCode } from "../src/index.js";

/** Asserts that `fn` throws a FieldbridgeError with the given code (and optional message pattern). */
export function expectCode(fn: () => unknown, code: FieldbridgeErrorCode, message?: RegExp): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected FieldbridgeError ${code}`).toBeInstanceOf(FieldbridgeError);
  expect((thrown as FieldbridgeError).code).toBe(code);
  if (message) expect((thrown as Error).message).toMatch(message);
}

/** "11 03 00 6B" → Uint8Array. Whitespace and colons are ignored. */
export function hex(text: string): Uint8Array {
  const clean = text.replace(/[\s:]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Uint8Array → "11 03 00 6B" (uppercase, space separated). */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

/** Pads a frame to the 60-byte Ethernet minimum, as serializers do. */
export function padEthernet(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 60) return bytes;
  const out = new Uint8Array(60);
  out.set(bytes);
  return out;
}
