# fieldbridge

Validated conversion of **frame envelopes** between industrial and automotive
protocols: Ethernet, PROFINET, PROFIBUS DP/PA, Modbus RTU/TCP, CAN / CAN FD,
LIN, FlexRay and EtherCAT.

- Strict validation against each protocol's limits on both encode and decode
- Payload bytes are preserved exactly; nothing is silently guessed
- Device IDs bridge message-addressed buses (CAN, LIN) and device-addressed buses (Modbus, PROFIBUS, EtherCAT)
- Parse and serialize real wire bytes (`fieldbridge/wire`): Modbus TCP/RTU, SocketCAN and candump, Ethernet, PROFINET RT, EtherCAT
- Typed errors with stable codes, plus a non-throwing `try*` API
- Zero runtime dependencies, ESM, TypeScript types included, Node.js 20+

## Install

```bash
npm install fieldbridge
```

## Quick start

```ts
import { convertMessage } from "fieldbridge";

const result = convertMessage({
  source: { deviceId: 17, message: { protocol: "can", identifier: 0x123, payload: [3, 0, 10] } },
  target: { protocol: "modbus-rtu" },
});

result.message;  // { protocol: "modbus-rtu", address: 17, deviceId: 17, payload: [3, 0, 10] }
result.warnings; // explains what was inferred or dropped
```

## Scope and limitations

fieldbridge converts the **envelope** (addresses, identifiers, payload limits,
metadata) and preserves payload bytes. It does **not** perform semantic,
bit-level translation: process images, device profiles, cycle timing, safety
semantics, endianness and vendor-specific mappings cannot be inferred safely
from an arbitrary frame. Applications that know those details can use a
`signals` mapping or supply their own adapter.

Every conversion returns `warnings` describing anything that was inferred,
overridden or dropped. Log them; they're how you learn what changed.

## API

### `convertFrame({ source, targetProtocol, options? })`

Converts a single frame.

```ts
import { convertFrame } from "fieldbridge";

const { frame, warnings } = convertFrame({
  source: { protocol: "ethernet", payload: [1], signals: { speed: 42 } },
  targetProtocol: "ethercat",
  options: {
    mapping: { speed: "velocity" },    // rename/select signals (unlisted ones are dropped)
    metadata: { cycle: "1ms" },        // metadata for the target frame
    targetDeviceId: 3,                 // target device if the frame has no address
  },
});
```

### `convertMessage({ source, target, options? })`

Converts a message that comes with a device identity and context.

```ts
convertMessage({
  source: { deviceId: "gateway-1", context: { line: "A" }, message: { protocol: "can", identifier: 0x12, payload: [1, 2] } },
  target: { protocol: "lin", context: { schedule: "body-controller-10ms" } },
});
```

- `source.deviceId` identifies the source device.
- `source.context` holds extra facts about the source, used as defaults for the message metadata.
- `target.deviceId` is the device to address on the target bus.
- `target.context` holds target-specific fields (schedule, slot, profile…). If an
  adapter declares required context keys, they must appear here; a missing key
  fails the conversion instead of being guessed.

### Non-throwing API: `tryConvertFrame` / `tryConvertMessage`

```ts
import { tryConvertMessage } from "fieldbridge";

const result = tryConvertMessage(request);
if (result.ok) {
  send(result.value.message);
} else {
  log(result.error.code, result.error.message); // e.g. "INVALID_DEVICE_ID"
}
```

The `try*` functions never throw. Errors that come from inside a custom adapter
are wrapped with code `INTERNAL`, and the original error is kept in `cause`.

### Errors

The throwing functions only throw `FieldbridgeError`, which has a stable
`code` and, where relevant, `protocol` and `field`. Branch on `code`, not on
the message text.

| Code | Meaning |
| --- | --- |
| `UNSUPPORTED_PROTOCOL` | Unknown protocol name |
| `INVALID_FRAME` | Input is not a valid frame/request object |
| `PROTOCOL_MISMATCH` | Frame given to the adapter of a different protocol |
| `INVALID_PAYLOAD` | Non-byte values or a protocol length rule violated |
| `PAYLOAD_TOO_LARGE` | Payload exceeds the protocol maximum |
| `MISSING_FIELD` | A required field (e.g. CAN identifier, Modbus address) is absent |
| `INVALID_FIELD` | A field is out of range |
| `MISSING_CONTEXT` | A required target context key is absent |
| `INVALID_DEVICE_ID` | A device ID cannot be used as a bus address |
| `CHECKSUM_MISMATCH` | A wire frame's checksum (Modbus RTU CRC) is wrong |
| `UNSUPPORTED_FEATURE` | Valid input that fieldbridge doesn't support yet (e.g. CAN error frames) |
| `INTERNAL` | Error raised by a custom adapter (try* API only) |

### Custom adapters: `createConverter` / `createAdapter`

The built-in `adapters` registry is frozen. To add or replace adapters, create
your own converter; nothing global is modified.

```ts
import { createAdapter, createConverter } from "fieldbridge";

const converter = createConverter({
  adapters: {
    ethercat: createAdapter({
      protocol: "ethercat",
      maxPayload: 1486,
      fields: ["address"],
      usesDeviceAddress: true,
      requiredContext: ["profile"],
      validate(frame) { /* throw FieldbridgeError on violations */ },
    }),
  },
});

converter.convertMessage({ /* ... */ });
converter.tryConvertFrame({ /* ... */ });
```

## Wire formats: `fieldbridge/wire`

The main API works on parsed frames. `fieldbridge/wire` turns raw bytes into
those frames and back. It's a separate entry point, so it's only loaded if you
import it. Parsing checks everything: lengths, checksums, header fields, and the
protocol rules enforced by the adapters.

```ts
import { convertFrame } from "fieldbridge";
import { parse, serialize } from "fieldbridge/wire";

// Modbus RTU -> Modbus TCP gateway
const [rtu] = parse("modbus-rtu", rtuBytes);         // CRC is verified
const { frame } = convertFrame({ source: rtu, targetProtocol: "modbus-tcp", options: { metadata: { transactionId: 1 } } });
socket.write(serialize(frame));                       // MBAP header is built for you
```

`parse(protocol, bytes)` always returns an **array** of frames, because one
Modbus TCP buffer can hold several ADUs and one EtherCAT frame several
datagrams. `serialize(frame)` returns a `Uint8Array`. Each format also has its own
`parseX` / `serializeX` function:

| Protocol | Functions | Format | Frame mapping |
| --- | --- | --- | --- |
| Modbus TCP | `parseModbusTcp`, `parseModbusTcpStream`, `serializeModbusTcp` | MBAP header + PDU | `address` = unit id, `payload` = PDU, `metadata.transactionId` |
| Modbus RTU | `parseModbusRtu`, `serializeModbusRtu`, `crc16Modbus` | address + PDU + CRC-16 | `address` = slave, `payload` = PDU |
| CAN / CAN FD | `parseSocketCan`, `serializeSocketCan` | Linux `struct can_frame` (16 B) / `canfd_frame` (72 B) | `identifier`, `metadata.extended / fd / brs / esi / rtr` |
| CAN / CAN FD | `parseCandumpLine`, `formatCandumpLine` | can-utils `candump` text: log format (`123#DEADBEEF`) and default display format (`can0  123   [4]  DE AD BE EF`); `format` writes the log format | as above, plus `metadata.timestamp / interface` |
| Ethernet | `parseEthernet`, `serializeEthernet` | Ethernet II / 802.3, optional 802.1Q | MACs in `destinationAddress` / `sourceAddress`, `identifier` = EtherType, `metadata.vlanId / vlanPriority` |
| PROFINET RT | `parseProfinet`, `serializeProfinet` | EtherType 0x8892 | `identifier` = FrameID, `payload` = IO data + APDU status |
| EtherCAT | `parseEthercat`, `serializeEthercat` | EtherType 0x88A4, one frame per datagram | `metadata.command / index / offset / workingCounter`; `address` for configured (FPxx) commands, `metadata.position` for auto-increment, `metadata.adp` for broadcast (counts the slaves that processed it), `metadata.logicalAddress` for logical commands |

`parseEthernetAuto(bytes)` detects PROFINET and EtherCAT from the EtherType. For
a TCP connection, feed each chunk to `parseModbusTcpStream`, which returns the
complete ADUs plus a `rest` to prepend to the next chunk.

Notes:
- Ethernet frames are read and written **without the FCS**, which is how most
  capture tools deliver them. Serialized frames are zero-padded to 60 bytes.
- Modbus RTU parsing expects **one complete frame**. Splitting a raw serial
  stream (by inter-frame silence) is up to your transport layer.
- LIN, FlexRay and PROFIBUS wire formats depend on the interface hardware and
  are not implemented yet. For those protocols `parse` / `serialize` throw
  `UNSUPPORTED_FEATURE`. `wireProtocols` lists the supported ones.

## Conversion rules

### Device IDs and bus addresses

Some buses address *devices* (Modbus slave/unit id, PROFIBUS station, EtherCAT
station). Others only address *messages* (CAN, LIN, FlexRay identifiers).
`deviceId` connects the two:

- **To a device-addressed bus**, the target `address` is the first available of:
  1. the `address` in the message
  2. `target.deviceId` (or `options.targetDeviceId`)
  3. the source `deviceId`

  A numeric `deviceId`, or a string like `"17"` or `"0x11"`, is used as the address.
  A name such as `"gateway-1"` is rejected with `INVALID_DEVICE_ID` instead of
  being guessed. The result is then checked against the target's address range.
- **From a device-addressed bus**, the source `address` becomes the result's
  `deviceId` when none was given.

### Conflicts: the message wins

When the message and the surrounding request disagree, **the value in the
message is used**, and a warning is added:

| Conflict | Used |
| --- | --- |
| `message.address` vs `target.deviceId` | `message.address` |
| `message.deviceId` vs `source.deviceId` | `message.deviceId` |
| `message.metadata` vs `source.context` | `message.metadata` |

`target.context` and `options.metadata` are *instructions for the target*,
not facts about the source, so they set the target frame's metadata. Any
message value they override is also reported in the warnings.

### Envelope fields

Each protocol declares which envelope fields it uses. A field the target
protocol doesn't use is dropped from the result and listed in the warnings.
For example, a CAN `identifier` has no meaning on Modbus.

| Protocol | Fields used | Payload limit | Other rules |
| --- | --- | --- | --- |
| Ethernet | `sourceAddress`, `destinationAddress` (MAC), `identifier` (EtherType) | 1500 bytes | MAC ≤ 48 bits, EtherType ≤ 0xFFFF |
| PROFINET | `sourceAddress`, `destinationAddress` (MAC), `identifier` (FrameID) | 1498 bytes (cyclic IO data 40..1440 + status) | FrameID ≤ 0xFFFF |
| PROFIBUS DP / PA | `address` (destination station), `sourceAddress` | 244 bytes | station addresses 0..127 |
| Modbus RTU | `address` | 253-byte PDU | address 0..247 required, valid function code |
| Modbus TCP | `address` (unit id) | 253-byte PDU | unit id 0..255 required, valid function code |
| CAN | `identifier` | 8 bytes classic; CAN FD DLC lengths up to 64 | identifier required; `metadata.extended` / `metadata.fd` flags, inferred when unambiguous |
| LIN | `identifier` | 1..8 bytes | 6-bit identifier required |
| FlexRay | `identifier` (slot) | 0..254 bytes, even length | slot 1..2047 required |
| EtherCAT | `address` (station) | 1486 bytes | station address ≤ 0xFFFF |

For Modbus, `payload` is the PDU (function code followed by data). The address
byte, MBAP header and CRC are not part of it.

## Development

```bash
npm install
npm test           # run the test suite
npm run typecheck  # type-check src, tests and examples
npm run build      # emit JavaScript and declarations into dist/
npm run example    # run the examples
```

Project layout:

```
src/
  index.ts            public API ("fieldbridge")
  core/               types, errors, validation, conversion engine, Result helpers
  adapters/           one adapter per protocol + shared rule helpers
  wire/               byte-level parse/serialize ("fieldbridge/wire")
    index.ts          generic parse()/serialize() + re-exports
    bytes.ts          shared byte helpers
    modbus.ts         Modbus TCP / RTU
    can.ts            SocketCAN binary, candump text
    ethernet.ts       Ethernet, PROFINET RT, EtherCAT
tests/
  helpers.ts          shared test helpers
  core/               adapter rules and conversion behaviour
  wire/               one file per wire format + end-to-end gateway scenarios
examples/             runnable usage examples
```

The wire tests use three kinds of reference data:

- **Published reference frames**: Modbus examples from the Modbus
  specification and simplymodbus.ca, and the can-utils `candump` examples.
- **Frames from real devices** (`tests/wire/real-captures.test.ts`), taken from
  public captures: Wireshark's EtherCAT sample, ITI's ICS-Security-Tools
  PROFINET and Modbus TCP captures, and Colorado State University's J1939
  truck `candump` log. Expected values come from Scapy's independent decoders.
- **Frames built byte by byte** from the specifications.

Every format is also checked to round-trip byte for byte. During development,
the complete captures were checked:

- **1,400+ Ethernet frames** (EtherCAT, PROFINET, Modbus TCP) against Scapy.
  Every field matched, except in frames Scapy can't decode (verified by hand)
  and frames that are deliberately malformed.
- **560,000+ CAN frames** from a J1939 truck and five EVs (Nissan Leaf,
  BMW i3, Ford Mustang Mach-E, Porsche Taycan, Dacia Spring), taken from
  public logs. All were parsed correctly; the only rejections were two lines
  that are damaged in the source log.

No public CAN FD capture was available, so CAN FD is covered by the tests
built from the specification.

## License

[MIT](LICENSE)
