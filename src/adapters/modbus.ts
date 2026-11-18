import { createAdapter } from "../core/adapter.js";
import type { NormalizedFrame } from "../core/types.js";
import { checkRange, payloadError, requireField } from "./rules.js";

/**
 * `payload` is the Modbus PDU: function code followed by data.
 * The PDU is limited to 253 bytes for both RTU and TCP
 * (RTU ADU 256 = 1 address + 253 PDU + 2 CRC; TCP ADU 260 = 7 MBAP + 253 PDU).
 */
const MAX_PDU = 253;

function createModbusValidator(maxAddress: number) {
  return (frame: NormalizedFrame): void => {
    requireField(frame, "address", "an address (set message.address or pass a numeric deviceId)");
    checkRange(frame, "address", 0, maxAddress);
    // Some requests are only a function code (0x07, 0x0B, 0x0C, 0x11), so the minimum PDU is 1 byte.
    if (frame.payload.length < 1) throw payloadError(frame, `${frame.protocol} payload must start with a function code`);
    const functionCode = frame.payload[0];
    // 1..127 are requests/normal responses; 0x81..0xFF are exception responses.
    if (functionCode === 0 || functionCode === 0x80) {
      throw payloadError(frame, `${frame.protocol} function code ${functionCode} is invalid`);
    }
  };
}

const common = { maxPayload: MAX_PDU, fields: ["address"], usesDeviceAddress: true } as const;

// RTU: 0 = broadcast, 1..247 = slave addresses (248..255 reserved).
export const modbusRtuAdapter = createAdapter({ protocol: "modbus-rtu", validate: createModbusValidator(247), ...common });
// TCP: unit identifier is a full byte.
export const modbusTcpAdapter = createAdapter({ protocol: "modbus-tcp", validate: createModbusValidator(255), ...common });
