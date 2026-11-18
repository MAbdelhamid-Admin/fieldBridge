// Frames taken verbatim from public captures of real devices. Expected values come
// from Scapy 2.6.1's independent decoders.
//
// Sources:
//  - EtherCAT: Wireshark SampleCaptures "ethercat.cap" (Beckhoff network boot-up)
//  - PROFINET: ITI/ICS-Security-Tools pcaps/profinet/PROFINET-RT-DCP
//  - Modbus TCP: ITI/ICS-Security-Tools pcaps (bro/modbus/modbusSmall.pcap, Digital Bond test data)
//  - CAN: Colorado State University J1939 data, candump_kw_drive (Kenworth T270 truck, `candump -l`)
//
// The full captures were checked the same way during development: 1,400+ Ethernet frames
// (every field matched Scapy, apart from frames Scapy can't decode or that are deliberately
// malformed) and 560,000+ CAN frames from a truck and five EVs.
import { describe, expect, it } from "vitest";
import {
  EthercatCommand,
  formatCandumpLine,
  parseCandumpLine,
  parseEthercat,
  parseModbusTcp,
  parseProfinet,
  parseSocketCan,
  serializeEthercat,
  serializeModbusTcp,
  serializeProfinet,
  serializeSocketCan,
} from "../../src/wire/index.js";
import { expectCode, hex, padEthernet } from "../helpers.js";

describe("real EtherCAT frames (Beckhoff boot-up)", () => {
  it("keeps the slave counter of a returning broadcast read", () => {
    // BRD of register 0x0130 (AL status) after passing 5 slaves: ADP was incremented to 5.
    const bytes = hex("ffffffffffff02144f2398cf88a40e100702050030010200040008000500000000000000000000000000000000000000000000000000000000000000");
    const [brd] = parseEthercat(bytes);
    expect(brd.metadata).toMatchObject({ command: EthercatCommand.BRD, adp: 5, offset: 0x0130, irq: 4, workingCounter: 5 });
    expect(brd.payload).toEqual([0x08, 0x00]);
    expect(serializeEthercat([brd])).toEqual(bytes);
  });

  it("parses a 7-datagram frame with auto-increment addressing", () => {
    const bytes = hex(
      "ffffffffffff02144f2398cf88a462100803050020010280040011000500070405003001028004000800050001050500300102800400080001000106040030010280040008000100010703003001028004000800010001080200300102800400080001000109010030010200040008000100",
    );
    const datagrams = parseEthercat(bytes);
    expect(datagrams.map((d) => d.metadata?.command)).toEqual([8, 7, 1, 1, 1, 1, 1]); // BWR, BRD, 5 x APRD
    expect(datagrams.slice(2).map((d) => d.metadata?.position)).toEqual([5, 4, 3, 2, 1]);
    expect(datagrams.map((d) => d.metadata?.workingCounter)).toEqual([5, 5, 1, 1, 1, 1, 1]);
    expect(serializeEthercat(datagrams)).toEqual(bytes);
  });
});

describe("real CAN frames (J1939 truck, candump -l)", () => {
  const lines = [
    "(1604007042.461135) can1 18FEBF0B#80067D7D79777B79", // PGN 65215 wheel speed, source 0x0B (brakes)
    "(1604007042.461719) can1 08FE6E0B#8006800640062006", // PGN 65134 high-res wheel speed
    "(1604007042.467043) can1 0CF00400#718388001500F0FF", // PGN 61444 EEC1 engine speed, source 0x00
  ];

  it("parses J1939 29-bit identifiers and reproduces each line exactly", () => {
    for (const line of lines) {
      const frame = parseCandumpLine(line);
      expect(frame.metadata).toMatchObject({ extended: true, fd: false, interface: "can1" });
      expect(frame.payload).toHaveLength(8);
      expect(formatCandumpLine(frame)).toBe(line);
    }
    expect(parseCandumpLine(lines[2]).identifier).toBe(0x0cf00400);
  });

  it("survives a SocketCAN binary round trip", () => {
    for (const line of lines) {
      const frame = parseCandumpLine(line);
      const back = parseSocketCan(serializeSocketCan(frame));
      expect(back.identifier).toBe(frame.identifier);
      expect(back.payload).toEqual(frame.payload);
    }
  });
});

describe("real PROFINET frames", () => {
  it("parses a DCP Identify response (FrameID 0xFEFE)", () => {
    const bytes = hex("010ecf000000001b1b029ac38892fefe05000300bf9a0001000c02020007737769746368330069656d656e732c2053494d41544900000000");
    const frame = parseProfinet(bytes);
    expect(frame.identifier).toBe(0xfefe);
    expect(frame.destinationAddress).toBe(0x010ecf000000);
    expect(frame.sourceAddress).toBe(0x001b1b029ac3);
    // Captured on the sending host before padding (56 bytes); serializing pads to the 60-byte minimum.
    expect(serializeProfinet(frame)).toEqual(padEthernet(bytes));
  });
});

describe("real Modbus TCP frames", () => {
  it("parses a Write Multiple Coils request and its response", () => {
    const request = parseModbusTcp(hex("000100000008010f000000030100"));
    expect(request).toMatchObject({ address: 1, payload: [0x0f, 0x00, 0x00, 0x00, 0x03, 0x01, 0x00], metadata: { transactionId: 1 } });
    const response = parseModbusTcp(hex("00010000000401010100"));
    expect(response.payload).toEqual([0x01, 0x01, 0x00]);
    expect(serializeModbusTcp(request)).toEqual(hex("000100000008010f000000030100"));
  });

  it("accepts requests that are only a function code (Report Server ID, 0x11)", () => {
    const frame = parseModbusTcp(hex("0000000000020a11"));
    expect(frame).toMatchObject({ address: 10, payload: [0x11] });
  });

  it("rejects a malformed frame from the Digital Bond test set (protocol id 0x0010)", () => {
    expectCode(() => parseModbusTcp(hex("0001001000060a0100010003")), "INVALID_FRAME", /protocol identifier/);
  });
});
