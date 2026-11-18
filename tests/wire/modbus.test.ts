import { describe, expect, it } from "vitest";
import {
  crc16Modbus,
  parseModbusRtu,
  parseModbusTcp,
  parseModbusTcpStream,
  serializeModbusRtu,
  serializeModbusTcp,
} from "../../src/wire/index.js";
import { expectCode, hex, toHex } from "../helpers.js";

// Reference frames: "Read Holding Registers" example (slave 17, registers 40108-40110),
// as published by simplymodbus.ca and matching the Modbus Application Protocol spec PDU.
const RTU_READ_REQUEST = "11 03 00 6B 00 03 76 87";
const TCP_READ_REQUEST = "00 01 00 00 00 06 11 03 00 6B 00 03";
const PDU_READ_REQUEST = [0x03, 0x00, 0x6b, 0x00, 0x03];

describe("CRC-16/MODBUS", () => {
  it("matches the standard check value for '123456789'", () => {
    expect(crc16Modbus(new TextEncoder().encode("123456789"))).toBe(0x4b37);
  });
});

describe("Modbus RTU", () => {
  it("parses the reference request", () => {
    const frame = parseModbusRtu(hex(RTU_READ_REQUEST));
    expect(frame).toEqual({ protocol: "modbus-rtu", address: 0x11, payload: PDU_READ_REQUEST });
  });

  it("parses other well-known frames", () => {
    expect(parseModbusRtu(hex("01 03 00 00 00 0A C5 CD")).payload).toEqual([3, 0, 0, 0, 10]);
    expect(parseModbusRtu(hex("01 83 02 C0 F1")).payload).toEqual([0x83, 0x02]); // exception response
  });

  it("serializes byte-for-byte", () => {
    expect(toHex(serializeModbusRtu({ protocol: "modbus-rtu", address: 0x11, payload: PDU_READ_REQUEST }))).toBe(RTU_READ_REQUEST);
  });

  it("rejects a corrupted CRC", () => {
    expectCode(() => parseModbusRtu(hex("11 03 00 6B 00 03 76 88")), "CHECKSUM_MISMATCH");
  });

  it("rejects truncated frames and invalid content", () => {
    expectCode(() => parseModbusRtu(hex("11 03 00")), "INVALID_FRAME");
    const badAddress = serializeModbusRtu({ protocol: "modbus-rtu", address: 1, payload: [3, 0] });
    badAddress[0] = 250;
    badAddress.set(hex(crcHex(badAddress)), badAddress.length - 2);
    expectCode(() => parseModbusRtu(badAddress), "INVALID_FIELD");
  });

  it("refuses to serialize a frame of another protocol", () => {
    expectCode(() => serializeModbusRtu({ protocol: "modbus-tcp", address: 1, payload: [3, 0] }), "PROTOCOL_MISMATCH");
  });
});

describe("Modbus TCP", () => {
  it("parses the reference request", () => {
    const frame = parseModbusTcp(hex(TCP_READ_REQUEST));
    expect(frame).toEqual({ protocol: "modbus-tcp", address: 0x11, payload: PDU_READ_REQUEST, metadata: { transactionId: 1 } });
  });

  it("serializes byte-for-byte", () => {
    const bytes = serializeModbusTcp({ protocol: "modbus-tcp", address: 0x11, payload: PDU_READ_REQUEST, metadata: { transactionId: 1 } });
    expect(toHex(bytes)).toBe(TCP_READ_REQUEST);
  });

  it("splits a stream with several ADUs and a partial one", () => {
    const second = "00 02 00 00 00 06 11 06 00 01 00 03"; // write single register
    const stream = hex(`${TCP_READ_REQUEST} ${second} 00 03 00 00 00 06 11`);
    const { frames, rest } = parseModbusTcpStream(stream);
    expect(frames.map((f) => f.metadata?.transactionId)).toEqual([1, 2]);
    expect(frames[1].payload).toEqual([6, 0, 1, 0, 3]);
    expect(toHex(rest)).toBe("00 03 00 00 00 06 11");
  });

  it("rejects bad MBAP headers", () => {
    expectCode(() => parseModbusTcp(hex("00 01 00 01 00 06 11 03 00 6B 00 03")), "INVALID_FRAME", /protocol identifier/);
    expectCode(() => parseModbusTcp(hex("00 01 00 00 00 09 11 03 00 6B 00 03")), "INVALID_FRAME", /truncated/);
    expectCode(() => parseModbusTcp(hex(`${TCP_READ_REQUEST} ${TCP_READ_REQUEST}`)), "INVALID_FRAME", /parseModbusTcpStream/);
  });

  it("validates the transaction id on serialize", () => {
    expectCode(() => serializeModbusTcp({ protocol: "modbus-tcp", address: 1, payload: [3, 0], metadata: { transactionId: 70000 } }), "INVALID_FIELD");
  });
});

function crcHex(frame: Uint8Array): string {
  const crc = crc16Modbus(frame, 0, frame.length - 2);
  return toHex(new Uint8Array([crc & 0xff, crc >>> 8]));
}
