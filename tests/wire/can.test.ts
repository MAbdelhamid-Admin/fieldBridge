import { describe, expect, it } from "vitest";
import { CAN_MTU, CANFD_MTU, formatCandumpLine, parseCandumpLine, parseSocketCan, serializeSocketCan } from "../../src/wire/index.js";
import { expectCode, hex } from "../helpers.js";

/** Builds a struct can_frame / canfd_frame by hand (little-endian can_id), independently of the serializer. */
function socketCan(mtu: number, canId: number, length: number, flags: number, data: number[]): Uint8Array {
  const out = new Uint8Array(mtu);
  new DataView(out.buffer).setUint32(0, canId >>> 0, true);
  out[4] = length;
  out[5] = flags;
  out.set(data, 8);
  return out;
}

describe("SocketCAN binary", () => {
  it("parses a classic standard frame", () => {
    const frame = parseSocketCan(socketCan(CAN_MTU, 0x123, 3, 0, [0xde, 0xad, 0xbe]));
    expect(frame).toEqual({ protocol: "can", identifier: 0x123, payload: [0xde, 0xad, 0xbe], metadata: { extended: false, fd: false } });
  });

  it("parses an extended frame", () => {
    const frame = parseSocketCan(socketCan(CAN_MTU, 0x80000000 | 0x18ff1234, 2, 0, [1, 2]));
    expect(frame.identifier).toBe(0x18ff1234);
    expect(frame.metadata?.extended).toBe(true);
  });

  it("parses a CAN FD frame with BRS", () => {
    const data = Array.from({ length: 12 }, (_, i) => i);
    const frame = parseSocketCan(socketCan(CANFD_MTU, 0x123, 12, 0x05, data));
    expect(frame.payload).toEqual(data);
    expect(frame.metadata).toMatchObject({ fd: true, brs: true, esi: false });
  });

  it("parses a remote frame", () => {
    const frame = parseSocketCan(socketCan(CAN_MTU, 0x40000000 | 0x123, 4, 0, []));
    expect(frame.payload).toEqual([]);
    expect(frame.metadata).toMatchObject({ rtr: true, rtrLength: 4 });
  });

  it("round-trips byte-for-byte", () => {
    for (const bytes of [
      socketCan(CAN_MTU, 0x123, 3, 0, [0xde, 0xad, 0xbe]),
      socketCan(CAN_MTU, 0x80000000 | 0x18ff1234, 8, 0, [1, 2, 3, 4, 5, 6, 7, 8]),
      socketCan(CAN_MTU, 0x40000000 | 0x7ff, 2, 0, []),
      socketCan(CANFD_MTU, 0x123, 64, 0x05, Array(64).fill(0xaa)),
    ]) {
      expect(serializeSocketCan(parseSocketCan(bytes))).toEqual(bytes);
    }
  });

  it("supports big-endian can_id", () => {
    const bytes = new Uint8Array(CAN_MTU);
    bytes.set([0x00, 0x00, 0x01, 0x23, 1], 0);
    bytes[8] = 0x42;
    expect(parseSocketCan(bytes, { littleEndian: false }).identifier).toBe(0x123);
  });

  it("rejects error frames, wrong sizes and impossible lengths", () => {
    expectCode(() => parseSocketCan(socketCan(CAN_MTU, 0x20000000 | 0x4, 8, 0, [])), "UNSUPPORTED_FEATURE");
    expectCode(() => parseSocketCan(new Uint8Array(15)), "INVALID_FRAME");
    expectCode(() => parseSocketCan(socketCan(CAN_MTU, 0x123, 9, 0, [])), "INVALID_FRAME");
    expectCode(() => parseSocketCan(socketCan(CANFD_MTU, 0x123, 10, 0x04, [])), "INVALID_PAYLOAD", /DLC/);
  });

  it("rejects remote frames that carry data or are CAN FD", () => {
    expectCode(() => serializeSocketCan({ protocol: "can", identifier: 1, payload: [1], metadata: { rtr: true } }), "INVALID_PAYLOAD");
    expectCode(() => serializeSocketCan({ protocol: "can", identifier: 1, payload: [], metadata: { rtr: true, fd: true } }), "INVALID_FIELD");
  });
});

describe("candump text", () => {
  // Examples from the can-utils documentation (cansend / candump).
  it("parses a log line with timestamp and interface", () => {
    const frame = parseCandumpLine("(1436509052.249713) vcan0 123#DEADBEEF");
    expect(frame).toEqual({
      protocol: "can",
      identifier: 0x123,
      payload: [0xde, 0xad, 0xbe, 0xef],
      metadata: { timestamp: 1436509052.249713, interface: "vcan0", extended: false, fd: false },
    });
  });

  it("parses extended, CAN FD and remote frames", () => {
    expect(parseCandumpLine("1F334455#1122334455667788")).toMatchObject({ identifier: 0x1f334455, metadata: { extended: true } });
    expect(parseCandumpLine("123##1112233")).toMatchObject({ payload: [0x11, 0x22, 0x33], metadata: { fd: true, brs: true } });
    expect(parseCandumpLine("123#R")).toMatchObject({ payload: [], metadata: { rtr: true, rtrLength: 0 } });
    expect(parseCandumpLine("123#R3").metadata?.rtrLength).toBe(3);
    expect(parseCandumpLine("5AA#11.22.33.44").payload).toEqual([0x11, 0x22, 0x33, 0x44]);
  });

  it("round-trips through formatCandumpLine", () => {
    for (const line of ["(1436509052.249713) vcan0 123#DEADBEEF", "1F334455#1122334455667788", "123##1112233", "123#R3", "can0 7FF#"]) {
      expect(formatCandumpLine(parseCandumpLine(line))).toBe(line);
    }
  });

  it("rejects malformed lines", () => {
    expectCode(() => parseCandumpLine("12#00"), "INVALID_FRAME");
    expectCode(() => parseCandumpLine("123#ABC"), "INVALID_FRAME");
    expectCode(() => parseCandumpLine("123##"), "INVALID_FRAME");
    expectCode(() => parseCandumpLine(""), "INVALID_FRAME");
  });

  it("parses candump's default display format", () => {
    expect(parseCandumpLine("(1436509052.249713)  vcan0  123   [3]  11 22 33")).toEqual({
      protocol: "can",
      identifier: 0x123,
      payload: [0x11, 0x22, 0x33],
      metadata: { timestamp: 1436509052.249713, interface: "vcan0", extended: false, fd: false },
    });
    expect(parseCandumpLine("  can0  1F334455   [8]  11 22 33 44 55 66 77 88")).toMatchObject({ identifier: 0x1f334455, metadata: { extended: true, fd: false } });
    expect(parseCandumpLine("  can0  123   [4]  remote request")).toMatchObject({ payload: [], metadata: { rtr: true, rtrLength: 4 } });
  });

  it("detects CAN FD in the display format from the two-digit length", () => {
    const twelve = "00 11 22 33 44 55 66 77 88 99 AA BB";
    expect(parseCandumpLine(`  can0  123  [12]  ${twelve}`)).toMatchObject({ metadata: { fd: true } });
    expect(parseCandumpLine("  can0  123  [02]  11 22").metadata?.fd).toBe(true);
  });

  it("rejects display lines whose byte count does not match the length", () => {
    expectCode(() => parseCandumpLine("  can0  123   [4]  11 22 33"), "INVALID_FRAME", /declares 4 bytes/);
  });

  it("agrees with the binary format", () => {
    const fromText = parseCandumpLine("123#DEADBE");
    const fromBinary = parseSocketCan(hex("23 01 00 00 03 00 00 00 DE AD BE 00 00 00 00 00"));
    expect(fromText).toEqual(fromBinary);
  });
});
