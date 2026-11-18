import { createAdapter } from "../core/adapter.js";
import type { NormalizedFrame } from "../core/types.js";
import { checkRange, payloadError, requireField } from "./rules.js";

const MAX_STANDARD_ID = 0x7ff; // 11-bit
const MAX_EXTENDED_ID = 0x1fffffff; // 29-bit
const CAN_FD_LENGTHS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64]);

/**
 * Optional metadata flags:
 * - `extended`: true for a 29-bit identifier. Inferred when the identifier exceeds 11 bits.
 * - `fd`: true for CAN FD. Inferred when the payload exceeds 8 bytes.
 */
function validateCan(frame: NormalizedFrame): void {
  requireField(frame, "identifier", "an 11/29-bit identifier");
  const extended = frame.metadata?.extended;
  checkRange(frame, "identifier", 0, extended === false ? MAX_STANDARD_ID : MAX_EXTENDED_ID);

  const length = frame.payload.length;
  const fd = frame.metadata?.fd;
  if (fd === false || (fd === undefined && length <= 8)) {
    if (length > 8) throw payloadError(frame, "Classic CAN payload exceeds 8 bytes");
  } else if (!CAN_FD_LENGTHS.has(length)) {
    throw payloadError(frame, `CAN FD payload length ${length} is not a valid DLC length (0-8, 12, 16, 20, 24, 32, 48, 64)`);
  }
}

export const canAdapter = createAdapter({ protocol: "can", maxPayload: 64, validate: validateCan, fields: ["identifier"] });
