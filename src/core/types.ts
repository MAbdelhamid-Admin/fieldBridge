export const protocols = [
  "ethernet",
  "profinet",
  "profibus-pa",
  "profibus-dp",
  "modbus-tcp",
  "modbus-rtu",
  "can",
  "lin",
  "flexray",
  "ethercat",
] as const;

export type Protocol = (typeof protocols)[number];
export type Byte = number;
export type DeviceId = string | number;
export type ProtocolValue = string | number | boolean;
export type ProtocolContext = Record<string, ProtocolValue>;
export type SignalValue = number | boolean;

/** Envelope fields whose meaning depends on the protocol. */
export const envelopeFields = ["address", "sourceAddress", "destinationAddress", "identifier"] as const;
export type EnvelopeField = (typeof envelopeFields)[number];

export interface NormalizedFrame {
  protocol: Protocol;
  payload: Byte[];
  deviceId?: DeviceId;
  address?: number;
  sourceAddress?: number;
  destinationAddress?: number;
  identifier?: number;
  metadata?: ProtocolContext;
  signals?: Record<string, SignalValue>;
}

export type ProtocolFrame = NormalizedFrame;

export interface ProtocolAdapter {
  readonly protocol: Protocol;
  /** Context keys that must be present in `metadata` when encoding. */
  readonly requiredContext: readonly string[];
  /** Envelope fields this protocol uses. Others are dropped (with a warning) on conversion. */
  readonly fields: readonly EnvelopeField[];
  /**
   * True when the protocol addresses devices through `address`
   * (Modbus slave/unit id, PROFIBUS station, EtherCAT station address).
   */
  readonly usesDeviceAddress: boolean;
  decode(frame: ProtocolFrame): NormalizedFrame;
  encode(frame: NormalizedFrame): ProtocolFrame;
}

export type AdapterRegistry = Readonly<Record<Protocol, ProtocolAdapter>>;

export interface ConversionOptions {
  /** Rename/select signals: `{ sourceName: targetName }`. Unlisted signals are dropped. */
  mapping?: Record<string, string>;
  metadata?: ProtocolContext;
  /** Device to address on the target bus when the message itself carries no address. */
  targetDeviceId?: DeviceId;
}

export interface ConversionResult {
  frame: ProtocolFrame;
  warnings: string[];
}

export interface ProtocolMessage {
  deviceId?: DeviceId;
  message: ProtocolFrame;
  context?: ProtocolContext;
}

export interface MessageConversionRequest {
  source: ProtocolMessage;
  target: {
    protocol: Protocol;
    /** Device to address on the target bus when the message itself carries no address. */
    deviceId?: DeviceId;
    context?: ProtocolContext;
  };
  options?: Omit<ConversionOptions, "targetDeviceId">;
}

export interface MessageConversionResult {
  deviceId?: DeviceId;
  message: ProtocolFrame;
  warnings: string[];
}
