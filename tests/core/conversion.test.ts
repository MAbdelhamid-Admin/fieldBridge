import { describe, expect, it } from "vitest";
import {
  adapters,
  convertFrame,
  convertMessage,
  createAdapter,
  createConverter,
  tryConvertFrame,
  tryConvertMessage,
  type ProtocolFrame,
} from "../../src/index.js";
import { expectCode } from "../helpers.js";

describe("convertFrame", () => {
  it("converts a CAN frame to Modbus RTU and reports limitations", () => {
    const result = convertFrame({
      source: { protocol: "can", identifier: 7, address: 1, payload: [3, 0, 10] },
      targetProtocol: "modbus-rtu",
    });
    expect(result.frame).toEqual({ protocol: "modbus-rtu", address: 1, payload: [3, 0, 10] });
    expect(result.warnings[0]).toMatch(/preserved/);
  });

  it("drops envelope fields the target does not use, with a warning", () => {
    const result = convertFrame({ source: { protocol: "can", identifier: 0x123, payload: [1, 2] }, targetProtocol: "ethercat" });
    expect(result.frame.identifier).toBeUndefined();
    expect(result.warnings.some((w) => /Dropped fields.*identifier=291/.test(w))).toBe(true);
  });

  it("keeps envelope fields shared by both protocols", () => {
    const result = convertFrame({ source: { protocol: "can", identifier: 0x12, payload: [1] }, targetProtocol: "lin" });
    expect(result.frame.identifier).toBe(0x12);
  });

  it("maps named signals only when requested", () => {
    const result = convertFrame({
      source: { protocol: "ethernet", payload: [1], signals: { speed: 42 } },
      targetProtocol: "ethercat",
      options: { mapping: { speed: "velocity" } },
    });
    expect(result.frame.signals).toEqual({ velocity: 42 });
  });

  it("warns about mapped signals that are missing", () => {
    const result = convertFrame({
      source: { protocol: "ethernet", payload: [1], signals: { speed: 42 } },
      targetProtocol: "ethercat",
      options: { mapping: { speed: "velocity", temp: "temperature" } },
    });
    expect(result.warnings.some((w) => /"temp"/.test(w))).toBe(true);
  });

  it("does not share mutable state between input and output", () => {
    const source: ProtocolFrame = { protocol: "ethernet", payload: [1], signals: { a: 1 }, metadata: { k: "v" } };
    const { frame } = convertFrame({ source, targetProtocol: "ethercat" });
    frame.payload.push(9);
    frame.signals!.a = 2;
    frame.metadata!.k = "changed";
    expect(source).toEqual({ protocol: "ethernet", payload: [1], signals: { a: 1 }, metadata: { k: "v" } });
  });

  it("rejects unknown protocols and malformed input", () => {
    expectCode(() => convertFrame({ source: { protocol: "ethernet", payload: [1] }, targetProtocol: "bogus" as never }), "UNSUPPORTED_PROTOCOL");
    expectCode(() => convertFrame(null as never), "INVALID_FRAME");
    expectCode(() => convertMessage({ source: { message: null as never }, target: { protocol: "can" } }), "INVALID_FRAME");
  });
});

describe("required context", () => {
  const converter = createConverter({
    adapters: { ethercat: createAdapter({ protocol: "ethercat", maxPayload: 1486, requiredContext: ["profile"] }) },
  });

  it("rejects a target when required context is absent", () => {
    expectCode(() => converter.convertMessage({
      source: { message: { protocol: "can", identifier: 1, payload: [1] } },
      target: { protocol: "ethercat" },
    }), "MISSING_CONTEXT", /profile/);
  });

  it("passes required context through to the target frame", () => {
    const result = converter.convertMessage({
      source: { message: { protocol: "can", identifier: 1, payload: [1] } },
      target: { protocol: "ethercat", context: { profile: "profile-a" } },
    });
    expect(result.message.metadata).toMatchObject({ profile: "profile-a" });
  });

  it("is enforced by convertFrame too", () => {
    expectCode(() => converter.convertFrame({ source: { protocol: "can", identifier: 1, payload: [1] }, targetProtocol: "ethercat" }), "MISSING_CONTEXT");
  });

  it("does not modify the built-in registry", () => {
    expect(adapters.ethercat.requiredContext).toEqual([]);
  });

  it("rejects an adapter registered under the wrong protocol", () => {
    expectCode(() => createConverter({ adapters: { can: adapters.lin } }), "PROTOCOL_MISMATCH");
  });
});

describe("device addressing", () => {
  it("uses the deviceId as the address when the source bus has none (CAN -> Modbus)", () => {
    const result = convertMessage({
      source: { deviceId: 17, message: { protocol: "can", identifier: 0x123, payload: [3, 0, 10] } },
      target: { protocol: "modbus-rtu" },
    });
    expect(result.message.address).toBe(17);
    expect(result.deviceId).toBe(17);
    expect(result.warnings.some((w) => /taken from deviceId/.test(w))).toBe(true);
  });

  it("accepts decimal and hex deviceId strings", () => {
    const result = convertMessage({
      source: { deviceId: "0x10", message: { protocol: "lin", identifier: 1, payload: [3, 0] } },
      target: { protocol: "modbus-tcp" },
    });
    expect(result.message.address).toBe(16);
  });

  it("refuses to guess an address from a non-numeric deviceId", () => {
    expectCode(() => convertMessage({
      source: { deviceId: "can-gateway-1", message: { protocol: "can", identifier: 1, payload: [3, 0] } },
      target: { protocol: "modbus-rtu" },
    }), "INVALID_DEVICE_ID");
  });

  it("uses target.deviceId when the message has no address, keeping the source identity", () => {
    const result = convertMessage({
      source: { deviceId: "can-gateway-1", message: { protocol: "can", identifier: 1, payload: [3, 0] } },
      target: { protocol: "modbus-rtu", deviceId: 5 },
    });
    expect(result.message.address).toBe(5);
    expect(result.deviceId).toBe("can-gateway-1");
  });

  it("validates the derived address against the target's range", () => {
    expectCode(() => convertMessage({
      source: { deviceId: 300, message: { protocol: "can", identifier: 1, payload: [3, 0] } },
      target: { protocol: "modbus-rtu" },
    }), "INVALID_FIELD", /0\.\.247/);
  });

  it("exposes a device-addressed source's address as the deviceId (Modbus -> Ethernet)", () => {
    const result = convertMessage({
      source: { message: { protocol: "modbus-rtu", address: 5, payload: [3, 0] } },
      target: { protocol: "ethernet" },
    });
    expect(result.deviceId).toBe(5);
    expect(result.message.address).toBeUndefined();
  });
});

describe("conflicts: the message wins", () => {
  it("message address beats target.deviceId", () => {
    const result = convertMessage({
      source: { message: { protocol: "modbus-tcp", address: 9, payload: [3, 0] } },
      target: { protocol: "modbus-rtu", deviceId: 2 },
    });
    expect(result.message.address).toBe(9);
    expect(result.warnings.some((w) => /ignored.*message address 9/.test(w))).toBe(true);
  });

  it("message deviceId beats source.deviceId", () => {
    const result = convertMessage({
      source: { deviceId: 3, message: { protocol: "can", identifier: 1, payload: [3, 0], deviceId: 8 } },
      target: { protocol: "modbus-rtu" },
    });
    expect(result.message.address).toBe(8);
    expect(result.deviceId).toBe(8);
    expect(result.warnings.some((w) => /source\.deviceId "3" ignored/.test(w))).toBe(true);
  });

  it("message metadata beats source.context", () => {
    const result = convertMessage({
      source: { context: { line: "A", site: "x" }, message: { protocol: "ethernet", payload: [1], metadata: { line: "B" } } },
      target: { protocol: "ethercat" },
    });
    expect(result.message.metadata).toEqual({ line: "B", site: "x" });
    expect(result.warnings.some((w) => /source\.context "line" ignored/.test(w))).toBe(true);
  });
});

describe("safe wrapper", () => {
  it("returns ok results", () => {
    const result = tryConvertFrame({ source: { protocol: "ethernet", payload: [1] }, targetProtocol: "ethercat" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.frame.protocol).toBe("ethercat");
  });

  it("returns typed errors instead of throwing", () => {
    const result = tryConvertMessage({
      source: { message: { protocol: "can", identifier: 1, payload: Array(9).fill(0), metadata: { fd: false } } },
      target: { protocol: "lin" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_PAYLOAD");
      expect(result.error.protocol).toBe("can");
    }
  });

  it("wraps errors from custom adapters as INTERNAL", () => {
    const converter = createConverter({
      adapters: { lin: { ...adapters.lin, encode: () => { throw new TypeError("boom"); } } },
    });
    const result = converter.tryConvertFrame({ source: { protocol: "can", identifier: 1, payload: [1] }, targetProtocol: "lin" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.cause).toBeInstanceOf(TypeError);
    }
  });
});
