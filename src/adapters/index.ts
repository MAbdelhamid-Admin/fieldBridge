import type { AdapterRegistry } from "../core/types.js";
import { ethernetAdapter } from "./ethernet.js";
import { profinetAdapter } from "./profinet.js";
import { profibusPaAdapter } from "./profibus-pa.js";
import { profibusDpAdapter } from "./profibus-dp.js";
import { modbusTcpAdapter, modbusRtuAdapter } from "./modbus.js";
import { canAdapter } from "./can.js";
import { linAdapter } from "./lin.js";
import { flexrayAdapter } from "./flexray.js";
import { ethercatAdapter } from "./ethercat.js";

/** Built-in adapters. Frozen: use `createConverter({ adapters })` to customise. */
export const adapters: AdapterRegistry = Object.freeze({
  ethernet: ethernetAdapter,
  profinet: profinetAdapter,
  "profibus-pa": profibusPaAdapter,
  "profibus-dp": profibusDpAdapter,
  "modbus-tcp": modbusTcpAdapter,
  "modbus-rtu": modbusRtuAdapter,
  can: canAdapter,
  lin: linAdapter,
  flexray: flexrayAdapter,
  ethercat: ethercatAdapter,
});
