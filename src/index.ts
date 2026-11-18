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
