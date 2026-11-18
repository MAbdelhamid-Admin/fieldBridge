import { describe, expect, it } from "vitest";
import type { NormalizedFrame } from "../../src/index.js";
import {
  EthercatCommand,
  parseEthercat,
  parseEthernet,
  parseEthernetAuto,
  parseProfinet,
  serializeEthercat,
  serializeEthernet,
  serializeProfinet,
} from "../../src/wire/index.js";
import { expectCode, hex, padEthernet } from "../helpers.js";

const DST = "01 02 03 04 05 06";
const SRC = "0A 0B 0C 0D 0E 0F";

describe("Ethernet", () => {
  it("parses an Ethernet II frame", () => {
    const frame = parseEthernet(hex(`${DST} ${SRC} 08 00 45 00 00 1C`));
    expect(frame).toEqual({
      protocol: "ethernet",
      destinationAddress: 0x010203040506,
      sourceAddress: 0x0a0b0c0d0e0f,
      identifier: 0x0800,
      payload: [0x45, 0x00, 0x00, 0x1c],
    });
  });

  it("strips padding from 802.3 frames using the length field", () => {
    const frame = parseEthernet(padEthernet(hex(`${DST} ${SRC} 00 03 AA BB CC`)));
    expect(frame.payload).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it("reads and writes 802.1Q VLAN tags", () => {
    const bytes = padEthernet(hex(`${DST} ${SRC} 81 00 C0 64 08 00 01 02`));
    const frame = parseEthernet(bytes);
    expect(frame.metadata).toEqual({ vlanId: 100, vlanPriority: 6 });
    expect(frame.identifier).toBe(0x0800);
    expect(serializeEthernet(frame)).toEqual(bytes);
  });

  it("pads serialized frames to 60 bytes", () => {
    const bytes = serializeEthernet({ protocol: "ethernet", destinationAddress: 1, sourceAddress: 2, identifier: 0x0800, payload: [1] });
    expect(bytes.length).toBe(60);
  });

  it("requires MACs and EtherType to serialize", () => {
    expectCode(() => serializeEthernet({ protocol: "ethernet", payload: [1] }), "MISSING_FIELD");
    expectCode(() => parseEthernet(hex("01 02 03")), "INVALID_FRAME", /truncated/);
  });
});

describe("PROFINET RT", () => {
  // Cyclic RT frame with VLAN priority 6, FrameID 0x8000, 40 bytes IO data + 4 bytes APDU status.
  const ioData = Array.from({ length: 40 }, (_, i) => i);
  const bytes = hex(`${DST} ${SRC} 81 00 C0 00 88 92 80 00 ${ioData.map((b) => b.toString(16).padStart(2, "0")).join(" ")} 12 34 35 00`);

  it("parses FrameID and payload", () => {
    const frame = parseProfinet(bytes);
    expect(frame.identifier).toBe(0x8000);
    expect(frame.payload).toEqual([...ioData, 0x12, 0x34, 0x35, 0x00]);
    expect(frame.metadata).toEqual({ vlanId: 0, vlanPriority: 6 });
  });

  it("round-trips byte-for-byte", () => {
    expect(serializeProfinet(parseProfinet(bytes))).toEqual(bytes);
  });

  it("rejects frames with another EtherType", () => {
    expectCode(() => parseProfinet(hex(`${DST} ${SRC} 08 00 00 00`)), "INVALID_FRAME", /EtherType/);
  });
});

describe("EtherCAT", () => {
  // Two datagrams built by hand from ETG.1000:
  //  1) BRD of register 0x0000, 2 bytes, WKC 3, "more" bit set
  //  2) FPRD to station 0x1001, register 0x0130 (AL status), data 08 00, WKC 1
  const frameBytes = padEthernet(hex(`
    FF FF FF FF FF FF 02 00 00 00 00 01 88 A4
    1C 10
    07 00 00 00 00 00 02 80 00 00 00 00 03 00
    04 01 01 10 30 01 02 00 00 00 08 00 01 00
  `));

  it("parses every datagram with its addressing", () => {
    const [brd, fprd] = parseEthercat(frameBytes);
    expect(brd.metadata).toMatchObject({ command: EthercatCommand.BRD, offset: 0, workingCounter: 3, ethernetSource: 0x020000000001 });
    expect(brd.address).toBeUndefined();
    expect(fprd.address).toBe(0x1001);
    expect(fprd.metadata).toMatchObject({ command: EthercatCommand.FPRD, index: 1, offset: 0x0130, workingCounter: 1 });
    expect(fprd.payload).toEqual([8, 0]);
  });

  it("round-trips byte-for-byte", () => {
    expect(serializeEthercat(parseEthercat(frameBytes))).toEqual(frameBytes);
  });

  it("handles auto-increment and logical addressing", () => {
    const datagrams: NormalizedFrame[] = [
      { protocol: "ethercat", payload: [0, 0], metadata: { command: EthercatCommand.APRD, position: -2, offset: 0x10, ethernetSource: 1 } },
      { protocol: "ethercat", payload: [1, 2, 3, 4], metadata: { command: EthercatCommand.LRW, logicalAddress: 0x00010000 } },
    ];
    const parsed = parseEthercat(serializeEthercat(datagrams));
    expect(parsed[0].metadata).toMatchObject({ position: -2, offset: 0x10 });
    expect(parsed[1].metadata).toMatchObject({ logicalAddress: 0x00010000 });
    expect(parsed[1].payload).toEqual([1, 2, 3, 4]);
  });

  it("requires the fields each command needs", () => {
    expectCode(() => serializeEthercat([{ protocol: "ethercat", payload: [], metadata: { ethernetSource: 1 } }]), "MISSING_FIELD", /command/);
    expectCode(() => serializeEthercat([{ protocol: "ethercat", payload: [], metadata: { command: 4, ethernetSource: 1 } }]), "MISSING_FIELD", /station/);
    expectCode(() => serializeEthercat([{ protocol: "ethercat", payload: [], metadata: { command: 7 } }]), "MISSING_FIELD", /source MAC/);
  });

  it("rejects truncated frames and unsupported frame types", () => {
    expectCode(() => parseEthercat(frameBytes.subarray(0, 30)), "INVALID_FRAME", /truncated/);
    expectCode(() => parseEthercat(hex("FF FF FF FF FF FF 02 00 00 00 00 01 88 A4 00 40")), "UNSUPPORTED_FEATURE");
  });
});

describe("parseEthernetAuto", () => {
  it("dispatches on EtherType", () => {
    expect(parseEthernetAuto(hex(`${DST} ${SRC} 88 92 80 00 01 02`))[0].protocol).toBe("profinet");
    expect(parseEthernetAuto(hex(`${DST} ${SRC} 08 00 01 02`))[0].protocol).toBe("ethernet");
  });
});
