/**
 * Connection diagnostics retain cause chains. Configurations that resolve
 * secrets replace every known secret value before text leaves the instance.
 */

import { HarnessError } from '@deepseek-ai/dsh-error'
import type { McpAuthorizationReason } from './types.ts'

/**
 * The global symbol the MCP SDK stamps on every error instance. Registering it
 * with `Symbol.for` lets the brand survive separate module copies, so this
 * module classifies SDK failures without importing the SDK at boot.
 */
const SDK_ERROR_BRANDS = Symbol.for('mcp.sdk.errorBrands')

/** Brand names of the SDK error classes this module classifies. */
const SDK_BRAND = {
  error: 'mcp.SdkError',
  http: 'mcp.SdkHttpError',
  protocol: 'mcp.ProtocolError',
  oauth: 'mcp.OAuthError',
  unauthorized: 'mcp.UnauthorizedError',
  insufficientScope: 'mcp.InsufficientScopeError',
} as const

/**
 * Whether one caught value carries the SDK brand of a class.
 * @param error - the caught value.
 * @param brand - the SDK class brand name.
 * @returns true when the value belongs to that class or a subclass.
 */
function hasSdkBrand(error: unknown, brand: string): boolean {
  if (typeof error !== 'object' || error === null) return false
  const brands: unknown = Reflect.get(error, SDK_ERROR_BRANDS)
  return brands instanceof Set && brands.has(brand)
}

/**
 * Read the `code` field the SDK attaches to its errors or HTTP responses.
 * @param error - the caught value.
 * @returns the code value, or undefined when absent.
 */
function errorCodeValue(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
}

/**
 * Read the stable string code the SDK attaches to its errors.
 * @param error - the caught value.
 * @returns the string code, or undefined when absent.
 */
function sdkErrorCode(error: unknown): string | undefined {
  const code = errorCodeValue(error)
  return typeof code === 'string' ? code : undefined
}

/**
 * Every {@link McpLocalError} code:
 * - `MCP_CONNECTION_CLOSED`: the connection generation closed; outcomes of requests in flight are unknown.
 * - `MCP_TIMEOUT`: a startup, operation, or cleanup budget elapsed.
 * - `MCP_CREDENTIALS_UNAVAILABLE`: credential templates are configured but no credentials provider is mounted.
 * - `MCP_CREDENTIAL_NOT_FOUND`: a referenced credential has no configured value.
 * - `MCP_INSTRUCTIONS_TOO_LARGE`: server instructions exceed `maxInstructionBytes`.
 * - `MCP_TOOL_REGISTRATION_FAILED`: a foreign registration occupies the server's tool namespace.
 * - `MCP_AUTHORIZATION_REQUIRED`: the server needs an OAuth authorization that no saved grant satisfies; `reason` names why.
 * - `MCP_OAUTH_FAILED`: an OAuth step failed locally, such as an unavailable issuer or a rejected callback.
 */
export const MCP_LOCAL_ERROR_CODES = [
  'MCP_CONNECTION_CLOSED',
  'MCP_TIMEOUT',
  'MCP_CREDENTIALS_UNAVAILABLE',
  'MCP_CREDENTIAL_NOT_FOUND',
  'MCP_INSTRUCTIONS_TOO_LARGE',
  'MCP_TOOL_REGISTRATION_FAILED',
  'MCP_AUTHORIZATION_REQUIRED',
  'MCP_OAUTH_FAILED',
] as const

/** One {@link McpLocalError} code. */
export type McpLocalErrorCode = typeof MCP_LOCAL_ERROR_CODES[number]

/**
 * Local failure whose message contains no expanded configuration or upstream
 * text; `code` is one of {@link MCP_LOCAL_ERROR_CODES}.
 */
export class McpLocalError extends HarnessError {
  override readonly code: McpLocalErrorCode

  constructor(message: string, code: McpLocalErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'McpLocalError'
    this.code = code
  }
}

/**
 * Every {@link McpToolError} code:
 * - `MCP_TOOL_ERROR`: the server answered the tool call with an `isError` result; the model may adjust its input.
 * - `MCP_UNSUPPORTED_TASK_EXECUTION`: the tool requires task-based execution, which the bridge does not support.
 * - `MCP_INVALID_RESULT`: the server's result violates the MCP result schema or the tool's advertised output
 *   schema, or that output schema cannot be compiled.
 * - `MCP_CONNECTION_CLOSED`: the connection closed while the request was in flight; its outcome is unknown.
 * - `MCP_TIMEOUT`: the request exceeded its deadline; its outcome is unknown.
 * - `MCP_SERVER_UNAVAILABLE`: the server was not connected, so the request was not sent.
 * - `MCP_REQUEST_FAILED`: any other protocol or SDK failure; `message` carries the JSON-RPC or SDK code.
 */
export const MCP_TOOL_ERROR_CODES = [
  'MCP_TOOL_ERROR',
  'MCP_UNSUPPORTED_TASK_EXECUTION',
  'MCP_INVALID_RESULT',
  'MCP_CONNECTION_CLOSED',
  'MCP_TIMEOUT',
  'MCP_SERVER_UNAVAILABLE',
  'MCP_REQUEST_FAILED',
] as const

/** One {@link McpToolError} code. */
export type McpToolErrorCode = typeof MCP_TOOL_ERROR_CODES[number]

/**
 * Failure of one MCP tool or resource request; `code` is one of
 * {@link MCP_TOOL_ERROR_CODES}. `message` may contain upstream text, redacted
 * when the instance resolves credential templates.
 */
export class McpToolError extends HarnessError {
  override readonly code: McpToolErrorCode

  constructor(message: string, code: McpToolErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'McpToolError'
    this.code = code
  }
}

/**
 * Codes for SDK-local failures whose consumer action differs from a generic
 * request failure. The keys are the SDK's `SdkErrorCode` wire values, kept
 * literal so classification needs no SDK import at boot.
 */
const SDK_ERROR_CODES: Partial<Record<string, McpToolErrorCode>> = {
  CONNECTION_CLOSED: 'MCP_CONNECTION_CLOSED',
  REQUEST_TIMEOUT: 'MCP_TIMEOUT',
  NOT_CONNECTED: 'MCP_SERVER_UNAVAILABLE',
  INVALID_RESULT: 'MCP_INVALID_RESULT',
}

/**
 * Classify one failed MCP request. An {@link McpLocalError}, such as the
 * generation's closure reason, keeps its identity; any other failure becomes
 * an {@link McpToolError} whose `message` carries the JSON-RPC or SDK code.
 * Without `redact` the original failure is the `cause`; with `redact` no
 * `cause` is attached, because the original text may contain secret values.
 * @param error - the request's rejection.
 * @param operation - names the request, such as `tool "echo"` or `resources/read`.
 * @param redact - removes secret values from the message when templates are enabled.
 * @returns the classified failure to throw.
 */
export function mcpRequestError(
  error: unknown,
  operation: string,
  redact?: (text: string) => string,
): HarnessError {
  if (error instanceof McpLocalError) return error
  let code: McpToolErrorCode = 'MCP_REQUEST_FAILED'
  let detail = describeError(error)
  const sdkCode = sdkErrorCode(error)
  if (hasSdkBrand(error, SDK_BRAND.protocol)) {
    const rpcCode = errorCodeValue(error)
    detail = `JSON-RPC error ${String(rpcCode)}: ${error instanceof Error ? error.message : String(error)}`
  } else if (hasSdkBrand(error, SDK_BRAND.error) && sdkCode !== undefined) {
    code = SDK_ERROR_CODES[sdkCode] ?? code
    detail = `${sdkCode}: ${error instanceof Error ? error.message : String(error)}`
  }
  const message = `MCP ${operation} failed: ${detail}`
  return redact === undefined
    ? new McpToolError(message, code, { cause: error })
    : new McpToolError(redact(message), code)
}

/** Safe authorization failure with no upstream messages or token values (`MCP_AUTHORIZATION_REQUIRED`). */
export class McpAuthorizationRequired extends McpLocalError {
  constructor(readonly reason: McpAuthorizationReason) {
    super('MCP OAuth requires authorization: ' + reason, 'MCP_AUTHORIZATION_REQUIRED')
  }
}

/**
 * Classify SDK authentication failures without treating ordinary forbidden responses as missing authorization.
 * @param error - local or SDK error from a connection, probe, or token request.
 * @returns an authorization reason, or undefined for other errors.
 */
export function oauthFailure(error: unknown): McpAuthorizationRequired | undefined {
  if (error instanceof McpAuthorizationRequired) return error
  if (hasSdkBrand(error, SDK_BRAND.insufficientScope)) return new McpAuthorizationRequired('scope')
  if (hasSdkBrand(error, SDK_BRAND.unauthorized)
    || hasSdkBrand(error, SDK_BRAND.http) && sdkErrorCode(error) === 'CLIENT_HTTP_AUTHENTICATION') {
    return new McpAuthorizationRequired('rejected')
  }
  const code = sdkErrorCode(error)
  if (hasSdkBrand(error, SDK_BRAND.oauth) && code !== undefined && reauthorizationCodes.has(code)) {
    return new McpAuthorizationRequired('rejected')
  }
  return undefined
}

/**
 * The SDK's `OAuthErrorCode` values that mean the saved grant must be replaced,
 * kept literal so classification needs no SDK import at boot.
 */
const reauthorizationCodes = new Set<string>(['invalid_grant', 'invalid_client', 'unauthorized_client'])

/** Placeholder written in place of a known secret value. */
const REDACTED = '[redacted]'

/**
 * Replace every occurrence of known secret values, longest first so a secret
 * that contains another is replaced whole.
 * @param text - diagnostic or upstream text.
 * @param secrets - non-empty secret values known to the instance.
 * @returns the text with each occurrence replaced by `[redacted]`.
 */
export function redactSecrets(text: string, secrets: Iterable<string>): string {
  let out = text
  for (const secret of [...secrets].sort((left, right) => right.length - left.length)) out = out.replaceAll(secret, REDACTED)
  return out
}

/** One readable segment of the chain; generic `Error` names are noise and dropped. */
function segmentOf(value: unknown): string {
  if (!(value instanceof Error)) return String(value)
  const base = value.name === 'Error' || value.message === ''
    ? (value.message === '' ? value.name : value.message)
    : `${value.name}: ${value.message}`
  if (base !== '' && base !== 'Error') return base
  // Some aggregate connect failures carry an empty message but a syscall code.
  const code = (value as { code?: unknown }).code
  return typeof code === 'string' ? code : value.name
}

/**
 * Flatten an error and its `cause` chain into `outer, cause: inner, …`.
 * @param error - the caught value; non-Errors stringify as-is.
 * @returns the joined diagnostic line.
 */
export function describeError(error: unknown): string {
  const seen = new Set<unknown>()
  const segments: string[] = []
  let current: unknown = error
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    // The outer segment keeps its error name (`TypeError: fetch failed`).
    segments.push(segments.length === 0 && current instanceof Error ? String(current) : segmentOf(current))
    current = current instanceof Error ? current.cause : undefined
  }
  const head = segments[0]
  if (head === undefined) return String(error)
  return head + segments.slice(1).map(segment => `, cause: ${segment}`).join('')
}
