// End-to-end gateway scenarios: bytes in -> convert -> bytes out.
import { describe, expect, it } from "vitest";
import { convertFrame, convertMessage } from "../../src/index.js";
import { parse, parseCandumpLine, serialize, wireProtocols } from "../../src/wire/index.js";
import { expectCode, hex, toHex } from "../helpers.js";

describe("gateway scenarios", () => {
  it("Modbus RTU -> Modbus TCP matches the published reference frames", () => {
    const [rtu] = parse("modbus-rtu", hex("11 03 00 6B 00 03 76 87"));
    const { frame } = convertFrame({ source: rtu, targetProtocol: "modbus-tcp", options: { metadata: { transactionId: 1 } } });
    expect(toHex(serialize(frame))).toBe("00 01 00 00 00 06 11 03 00 6B 00 03");
  });

  it("Modbus TCP -> Modbus RTU adds the correct CRC", () => {
    const [tcp] = parse("modbus-tcp", hex("00 01 00 00 00 06 11 03 00 6B 00 03"));
    const { frame } = convertFrame({ source: tcp, targetProtocol: "modbus-rtu" });
    expect(toHex(serialize(frame))).toBe("11 03 00 6B 00 03 76 87");
  });

  it("candump CAN line -> Modbus RTU via deviceId", () => {
    const can = parseCandumpLine("123#03006B0003");
    const result = convertMessage({ source: { deviceId: 0x11, message: can }, target: { protocol: "modbus-rtu" } });
    expect(toHex(serialize(result.message))).toBe("11 03 00 6B 00 03 76 87");
  });
});

describe("generic parse / serialize", () => {
  it("lists the protocols with a wire format", () => {
    expect(wireProtocols).toEqual(["modbus-tcp", "modbus-rtu", "can", "ethernet", "profinet", "ethercat"]);
  });

  it("reports protocols without a wire format", () => {
    expectCode(() => parse("lin", [0]), "UNSUPPORTED_FEATURE");
    expectCode(() => serialize({ protocol: "flexray", identifier: 1, payload: [] }), "UNSUPPORTED_FEATURE");
  });

  it("rejects incomplete Modbus TCP data", () => {
    expectCode(() => parse("modbus-tcp", hex("00 01 00 00 00 06 11")), "INVALID_FRAME", /incomplete/);
  });

  it("accepts plain number arrays and validates them", () => {
    expect(parse("modbus-rtu", [0x11, 0x03, 0x00, 0x6b, 0x00, 0x03, 0x76, 0x87])[0].address).toBe(0x11);
    expectCode(() => parse("modbus-rtu", [300, 1, 2, 3]), "INVALID_PAYLOAD");
  });
});
