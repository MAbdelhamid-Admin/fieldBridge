/**
 * Validated conversion of frame envelopes between industrial and automotive protocols.
 *
 * Start with {@link convertFrame} or {@link convertMessage}; use {@link tryConvertFrame} /
 * {@link tryConvertMessage} for a non-throwing API and {@link createConverter} for custom adapters.
 * For raw bytes, see the `fieldbridge/wire` entry point.
 *
 * @module fieldbridge
 */
export * from "./core/types.js";
export { FieldbridgeError, isFieldbridgeError, type FieldbridgeErrorCode, type FieldbridgeErrorDetails } from "./core/errors.js";
export { toResult, type Result } from "./core/result.js";
export { assertProtocol, isProtocol, validateFrame } from "./core/validation.js";
export { createAdapter, type AdapterDefinition } from "./core/adapter.js";
export {
  convertFrame,
  convertMessage,
  createConverter,
  supportedProtocols,
  tryConvertFrame,
  tryConvertMessage,
  type Converter,
  type ConverterOptions,
  type FrameConversionRequest,
} from "./core/convert.js";
export { adapters } from "./adapters/index.js";
