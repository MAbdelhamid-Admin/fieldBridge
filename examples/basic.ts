import { convertMessage, tryConvertMessage } from "../src/index.js";

// CAN has no device addressing, so deviceId 17 becomes the Modbus slave address.
// The CAN identifier is dropped (Modbus has none) and reported in the warnings.
const result = convertMessage({
  source: { deviceId: 17, message: { protocol: "can", identifier: 0x123, payload: [0x03, 0x00, 0x0a] } },
  target: { protocol: "modbus-rtu" },
});
console.log(result.message);
console.log(result.warnings.join("\n"));

// Non-throwing variant: inspect error codes instead of catching exceptions.
const failed = tryConvertMessage({
  source: { deviceId: "gateway-1", message: { protocol: "can", identifier: 0x123, payload: [0x03, 0x00] } },
  target: { protocol: "modbus-rtu" },
});
if (!failed.ok) console.log(`\n${failed.error.code}: ${failed.error.message}`);
