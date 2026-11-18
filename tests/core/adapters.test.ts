import { describe, expect, it } from "vitest";
import { adapters, validateFrame } from "../../src/index.js";
import { expectCode } from "../helpers.js";

describe("generic validation", () => {
  it("rejects invalid bytes", () => {
    expectCode(() => validateFrame({ protocol: "ethernet", payload: [256] }), "INVALID_PAYLOAD");
  });

  it("reports malformed frames instead of crashing", () => {
    expectCode(() => adapters["modbus-rtu"].encode({ protocol: "modbus-rtu", address: 1 } as never), "INVALID_PAYLOAD");
  });

  it("rejects a frame decoded by the wrong adapter", () => {
    expectCode(() => adapters.can.decode({ protocol: "lin", identifier: 1, payload: [1] }), "PROTOCOL_MISMATCH");
  });

  it("enforces payload limits on encode and decode", () => {
    expectCode(() => adapters.lin.encode({ protocol: "lin", identifier: 1, payload: Array(9).fill(0) }), "PAYLOAD_TOO_LARGE");
    expectCode(() => adapters.lin.decode({ protocol: "lin", identifier: 1, payload: Array(9).fill(0) }), "PAYLOAD_TOO_LARGE");
  });

  it("freezes the built-in registry", () => {
    expect(Object.isFrozen(adapters)).toBe(true);
  });
});

describe("CAN", () => {
  it("round-trips a frame without changing bytes", () => {
    const frame = { protocol: "can" as const, identifier: 0x123, payload: [1, 2, 3] };
    expect(adapters.can.encode(adapters.can.decode(frame))).toEqual(frame);
  });

  it("limits classic CAN to 8 bytes and CAN FD to valid DLC lengths", () => {
    expectCode(() => adapters.can.encode({ protocol: "can", identifier: 1, payload: Array(9).fill(0), metadata: { fd: false } }), "INVALID_PAYLOAD", /8 bytes/);
    expectCode(() => adapters.can.encode({ protocol: "can", identifier: 1, payload: Array(10).fill(0) }), "INVALID_PAYLOAD", /DLC/);
    expect(adapters.can.encode({ protocol: "can", identifier: 1, payload: Array(12).fill(0) }).payload).toHaveLength(12);
  });

  it("checks standard vs extended identifiers", () => {
    expectCode(() => adapters.can.encode({ protocol: "can", identifier: 0x800, payload: [], metadata: { extended: false } }), "INVALID_FIELD");
    expectCode(() => adapters.can.encode({ protocol: "can", identifier: 0x2000_0000, payload: [] }), "INVALID_FIELD");
    expectCode(() => adapters.can.encode({ protocol: "can", payload: [] }), "MISSING_FIELD");
  });
});

describe("Modbus", () => {
  it("validates address, PDU size and function code", () => {
    expectCode(() => adapters["modbus-rtu"].encode({ protocol: "modbus-rtu", payload: [3, 0] }), "MISSING_FIELD", /address/);
    expectCode(() => adapters["modbus-rtu"].encode({ protocol: "modbus-rtu", address: 1, payload: [] }), "INVALID_PAYLOAD", /function code/);
    expect(adapters["modbus-rtu"].encode({ protocol: "modbus-rtu", address: 1, payload: [0x11] }).payload).toEqual([0x11]); // function code only
    expectCode(() => adapters["modbus-tcp"].encode({ protocol: "modbus-tcp", address: 1, payload: [3, ...Array(253).fill(0)] }), "PAYLOAD_TOO_LARGE");
    expectCode(() => adapters["modbus-rtu"].encode({ protocol: "modbus-rtu", address: 248, payload: [3, 0] }), "INVALID_FIELD");
    expectCode(() => adapters["modbus-rtu"].encode({ protocol: "modbus-rtu", address: 1, payload: [0, 0] }), "INVALID_PAYLOAD");
  });

  it("accepts exception responses", () => {
    expect(adapters["modbus-rtu"].encode({ protocol: "modbus-rtu", address: 1, payload: [0x83, 2] }).payload).toEqual([0x83, 2]);
  });
});

describe("other protocols", () => {
  it("requires FlexRay slot IDs and even payload lengths", () => {
    expectCode(() => adapters.flexray.encode({ protocol: "flexray", payload: [1, 2] }), "MISSING_FIELD");
    expectCode(() => adapters.flexray.encode({ protocol: "flexray", identifier: 5, payload: [1] }), "INVALID_PAYLOAD");
  });

  it("validates PROFIBUS station, EtherCAT station and Ethernet EtherType ranges", () => {
    expectCode(() => adapters["profibus-dp"].encode({ protocol: "profibus-dp", address: 200, payload: [1] }), "INVALID_FIELD");
    expectCode(() => adapters.ethercat.encode({ protocol: "ethercat", address: 0x10000, payload: [1] }), "INVALID_FIELD");
    expectCode(() => adapters.ethernet.encode({ protocol: "ethernet", identifier: 0x10000, payload: [1] }), "INVALID_FIELD");
  });
});
