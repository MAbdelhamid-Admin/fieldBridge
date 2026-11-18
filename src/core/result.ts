import { FieldbridgeError } from "./errors.js";

/** Outcome of a non-throwing (`try*`) call. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: FieldbridgeError };

/** Runs `fn` and captures any thrown error. Non-library errors are wrapped as code "INTERNAL". */
export function toResult<T>(fn: () => T): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    if (error instanceof FieldbridgeError) return { ok: false, error };
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: new FieldbridgeError("INTERNAL", message, { cause: error }) };
  }
}
