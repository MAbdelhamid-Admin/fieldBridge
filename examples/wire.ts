import { convertFrame, convertMessage } from "../src/index.js";
import { parse, parseCandumpLine, serialize } from "../src/wire/index.js";

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

// 1. Modbus RTU -> Modbus TCP gateway (CRC verified, MBAP header built).
const rtuBytes = new Uint8Array([0x11, 0x03, 0x00, 0x6b, 0x00, 0x03, 0x76, 0x87]);
const [rtu] = parse("modbus-rtu", rtuBytes);
const tcp = convertFrame({ source: rtu, targetProtocol: "modbus-tcp", options: { metadata: { transactionId: 1 } } });
console.log("RTU ", toHex(rtuBytes));
console.log("TCP ", toHex(serialize(tcp.frame)));

// 2. A candump line from a CAN bus -> Modbus RTU slave 17.
const can = parseCandumpLine("(1436509052.249713) can0 123#03006B0003");
const rtuOut = convertMessage({ source: { deviceId: 17, message: can }, target: { protocol: "modbus-rtu" } });
console.log("CAN ", "123#03006B0003");
console.log("RTU ", toHex(serialize(rtuOut.message)));
console.log(rtuOut.warnings.map((w) => `  - ${w}`).join("\n"));
