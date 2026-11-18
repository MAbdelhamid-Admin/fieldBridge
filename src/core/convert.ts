import { adapters as builtInAdapters } from "../adapters/index.js";
import { FieldbridgeError } from "./errors.js";
import { toResult, type Result } from "./result.js";
import {
  envelopeFields,
  protocols,
  type AdapterRegistry,
  type ConversionOptions,
  type ConversionResult,
  type DeviceId,
  type MessageConversionRequest,
  type MessageConversionResult,
  type NormalizedFrame,
  type Protocol,
  type ProtocolAdapter,
  type ProtocolContext,
  type ProtocolFrame,
  type SignalValue,
} from "./types.js";
import { assertProtocol, validateFrame } from "./validation.js";

export interface FrameConversionRequest {
  source: ProtocolFrame;
  targetProtocol: Protocol;
  options?: ConversionOptions;
}

export interface ConverterOptions {
  /** Adapters that replace the built-in ones for the given protocols. */
  adapters?: Partial<Record<Protocol, ProtocolAdapter>>;
}

export interface Converter {
  readonly adapters: AdapterRegistry;
  /** Converts a frame; throws FieldbridgeError on failure. */
  convertFrame(input: FrameConversionRequest): ConversionResult;
  /** Converts a message with device identity and context; throws FieldbridgeError on failure. */
  convertMessage(input: MessageConversionRequest): MessageConversionResult;
  /** Like convertFrame, but never throws. */
  tryConvertFrame(input: FrameConversionRequest): Result<ConversionResult>;
  /** Like convertMessage, but never throws. */
  tryConvertMessage(input: MessageConversionRequest): Result<MessageConversionResult>;
}

/** Parses a device ID (number, decimal string, or 0x-hex string) into a bus address. */
function parseDeviceAddress(deviceId: DeviceId): number | undefined {
  const value =
    typeof deviceId === "number" ? deviceId
    : /^\d+$/.test(deviceId) ? Number(deviceId)
    : /^0x[0-9a-f]+$/i.test(deviceId) ? Number.parseInt(deviceId, 16)
    : Number.NaN;
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function toDeviceAddress(protocol: Protocol, deviceId: DeviceId): number {
  const address = parseDeviceAddress(deviceId);
  if (address === undefined) {
    throw new FieldbridgeError(
      "INVALID_DEVICE_ID",
      `${protocol} addresses devices by number; deviceId "${deviceId}" cannot be used as an address. ` +
        "Pass a numeric target deviceId or set message.address.",
      { protocol, field: "deviceId" },
    );
  }
  return address;
}

function mapSignals(
  signals: Record<string, SignalValue> | undefined,
  mapping: Record<string, string>,
  warnings: string[],
): Record<string, SignalValue> {
  const mapped: Record<string, SignalValue> = {};
  for (const [from, to] of Object.entries(mapping)) {
    const value = signals?.[from];
    if (value === undefined) warnings.push(`Mapped signal "${from}" is not present in the source frame.`);
    else mapped[to] = value;
  }
  return mapped;
}

function buildRegistry(overrides: ConverterOptions["adapters"] = {}): AdapterRegistry {
  const registry = { ...builtInAdapters };
  for (const [protocol, adapter] of Object.entries(overrides)) {
    assertProtocol(protocol);
    if (!adapter) continue;
    if (adapter.protocol !== protocol) {
      throw new FieldbridgeError("PROTOCOL_MISMATCH", `Adapter for "${protocol}" reports protocol "${adapter.protocol}"`, { protocol });
    }
    registry[protocol] = adapter;
  }
  return Object.freeze(registry);
}

export function createConverter(options: ConverterOptions = {}): Converter {
  const registry = buildRegistry(options.adapters);

  function convertFrame(input: FrameConversionRequest): ConversionResult {
    if (input === null || typeof input !== "object") {
      throw new FieldbridgeError("INVALID_FRAME", "conversion request must be an object");
    }
    validateFrame(input.source);
    assertProtocol(input.targetProtocol);
    const sourceAdapter = registry[input.source.protocol];
    const targetAdapter = registry[input.targetProtocol];
    const opts = input.options ?? {};
    const warnings = ["Payload bytes were preserved; no protocol-specific semantic mapping was inferred."];

    const normalized = sourceAdapter.decode(input.source);

    // On buses that address devices (Modbus, PROFIBUS, EtherCAT) the address *is* the device identity.
    const deviceId = normalized.deviceId ?? (sourceAdapter.usesDeviceAddress ? normalized.address : undefined);

    // Signals
    let signals = normalized.signals;
    if (opts.mapping) signals = mapSignals(normalized.signals, opts.mapping, warnings);
    else warnings.push("Provide an explicit signal mapping when process-image conversion is required.");

    // Metadata: explicit target metadata is an instruction for the output, so it overrides the message's.
    const metadata: ProtocolContext = { ...normalized.metadata };
    for (const [key, value] of Object.entries(opts.metadata ?? {})) {
      if (metadata[key] !== undefined && metadata[key] !== value) {
        warnings.push(`metadata "${key}": message value ${JSON.stringify(metadata[key])} replaced by target value ${JSON.stringify(value)}.`);
      }
      metadata[key] = value;
    }

    // Target device address. Priority: address in the message > target deviceId > source deviceId.
    let address: number | undefined;
    if (targetAdapter.usesDeviceAddress) {
      if (normalized.address !== undefined) {
        address = normalized.address;
        if (opts.targetDeviceId !== undefined && parseDeviceAddress(opts.targetDeviceId) !== address) {
          warnings.push(`Target deviceId "${opts.targetDeviceId}" ignored; the message address ${address} takes priority.`);
        }
      } else if (opts.targetDeviceId !== undefined) {
        address = toDeviceAddress(input.targetProtocol, opts.targetDeviceId);
      } else if (deviceId !== undefined) {
        address = toDeviceAddress(input.targetProtocol, deviceId);
        warnings.push(`${input.targetProtocol} address ${address} was taken from deviceId.`);
      }
    } else if (opts.targetDeviceId !== undefined) {
      warnings.push(`Target deviceId "${opts.targetDeviceId}" ignored; ${input.targetProtocol} does not address devices.`);
    }

    // Build the target frame with only the envelope fields the target protocol uses.
    const target: NormalizedFrame = { protocol: input.targetProtocol, payload: normalized.payload };
    if (deviceId !== undefined) target.deviceId = deviceId;
    const dropped: string[] = [];
    for (const field of envelopeFields) {
      const value = field === "address" && address !== undefined ? address : normalized[field];
      if (value === undefined) continue;
      if (targetAdapter.fields.includes(field)) target[field] = value;
      else if (!(field === "address" && sourceAdapter.usesDeviceAddress)) dropped.push(`${field}=${value}`);
    }
    if (dropped.length > 0) {
      warnings.push(`Dropped fields not used by ${input.targetProtocol}: ${dropped.join(", ")}.`);
    }
    if (Object.keys(metadata).length > 0) target.metadata = metadata;
    if (signals !== undefined) target.signals = signals;

    return { frame: targetAdapter.encode(target), warnings };
  }

  function convertMessage(input: MessageConversionRequest): MessageConversionResult {
    if (input === null || typeof input !== "object" || input.source === null || typeof input.source !== "object" || input.target === null || typeof input.target !== "object") {
      throw new FieldbridgeError("INVALID_FRAME", "conversion request must have source and target objects");
    }
    const message = input.source.message;
    validateFrame(message);
    assertProtocol(input.target.protocol);

    // Required target fields must come from the target context, not leak in from the source.
    for (const field of registry[input.target.protocol].requiredContext) {
      if (input.target.context?.[field] === undefined) {
        throw new FieldbridgeError("MISSING_CONTEXT", `${input.target.protocol} requires target context field "${field}"`, {
          protocol: input.target.protocol,
          field,
        });
      }
    }

    const warnings: string[] = [];

    // The message is authoritative: its own deviceId and metadata win over the surrounding request.
    let deviceId = input.source.deviceId;
    if (message.deviceId !== undefined) {
      if (deviceId !== undefined && String(deviceId) !== String(message.deviceId)) {
        warnings.push(`source.deviceId "${deviceId}" ignored; the message deviceId "${message.deviceId}" takes priority.`);
      }
      deviceId = message.deviceId;
    }
    const sourceMetadata: ProtocolContext = { ...input.source.context };
    for (const [key, value] of Object.entries(message.metadata ?? {})) {
      if (sourceMetadata[key] !== undefined && sourceMetadata[key] !== value) {
        warnings.push(`source.context "${key}" ignored; the message value ${JSON.stringify(value)} takes priority.`);
      }
      sourceMetadata[key] = value;
    }

    const source: ProtocolFrame = { ...message };
    if (deviceId !== undefined) source.deviceId = deviceId;
    if (Object.keys(sourceMetadata).length > 0) source.metadata = sourceMetadata;

    const targetMetadata = { ...input.options?.metadata, ...input.target.context };
    const result = convertFrame({
      source,
      targetProtocol: input.target.protocol,
      options: {
        ...input.options,
        ...(input.target.deviceId !== undefined ? { targetDeviceId: input.target.deviceId } : {}),
        ...(Object.keys(targetMetadata).length > 0 ? { metadata: targetMetadata } : {}),
      },
    });

    const out: MessageConversionResult = { message: result.frame, warnings: [...result.warnings, ...warnings] };
    if (result.frame.deviceId !== undefined) out.deviceId = result.frame.deviceId;
    return out;
  }

  return Object.freeze({
    adapters: registry,
    convertFrame,
    convertMessage,
    tryConvertFrame: (input: FrameConversionRequest) => toResult(() => convertFrame(input)),
    tryConvertMessage: (input: MessageConversionRequest) => toResult(() => convertMessage(input)),
  });
}

const defaultConverter = createConverter();

export const convertFrame = defaultConverter.convertFrame;
export const convertMessage = defaultConverter.convertMessage;
export const tryConvertFrame = defaultConverter.tryConvertFrame;
export const tryConvertMessage = defaultConverter.tryConvertMessage;

/** All protocols supported by the built-in adapters. */
export const supportedProtocols: readonly Protocol[] = protocols;
