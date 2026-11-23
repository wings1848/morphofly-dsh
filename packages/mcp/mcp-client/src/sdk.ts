/**
 * MCP SDK accessors: the wire SDK loads on the first connection, never at boot.
 *
 * Every loader is single-flight and shares one in-flight import. A failed
 * import is forgotten, so the next connection retries it.
 *
 * @module dsh-mcp-client/sdk
 */

/** The MCP client SDK module as the connection paths use it. */
export type McpSdk = typeof import('@modelcontextprotocol/client')

/** The MCP core protocol schemas as the OAuth record paths use them. */
export type McpCore = typeof import('@modelcontextprotocol/core')

/** The MCP stdio transport entry as the transport factory uses it. */
export type McpStdio = typeof import('@modelcontextprotocol/client/stdio')

/** The SDK's AJV schema validator entry as the tool bridge uses it. */
export type McpValidators = typeof import('@modelcontextprotocol/client/validators/ajv')

/** One lazy entry and its in-flight import. */
interface LoadSlot<T> {
  /** The import every caller shares; undefined before the first caller and after a failure. */
  promise: Promise<T> | undefined
}

/**
 * Forget a failed single-flight import so the next caller retries it.
 * @param slot - the entry's slot, cleared before the rejection propagates.
 * @returns a rejection handler that fails the original caller unchanged.
 */
function forgetOnFailure<T>(slot: LoadSlot<T>): (error: unknown) => never {
  /* v8 ignore next 4 -- the success path is covered; a failed import must not poison the next connection */
  return (error: unknown) => {
    slot.promise = undefined
    throw error
  }
}

/** One in-flight SDK import shared by every connection that needs it. */
const sdkSlot: LoadSlot<McpSdk> = { promise: undefined }
/** One in-flight core import shared by every OAuth record path that needs it. */
const coreSlot: LoadSlot<McpCore> = { promise: undefined }
/** One in-flight stdio-entry import shared by every stdio connection. */
const stdioSlot: LoadSlot<McpStdio> = { promise: undefined }
/** One in-flight validator import shared by every tool sync that needs it. */
const validatorsSlot: LoadSlot<McpValidators> = { promise: undefined }

/**
 * Load the MCP client SDK on demand.
 * @returns the SDK module, imported once and cached by the module system.
 */
export function loadSdk(): Promise<McpSdk> {
  return sdkSlot.promise ??= import('@modelcontextprotocol/client').catch(forgetOnFailure(sdkSlot))
}

/**
 * Load the MCP core protocol schemas on demand.
 * @returns the core module, imported once and cached by the module system.
 */
export function loadCore(): Promise<McpCore> {
  return coreSlot.promise ??= import('@modelcontextprotocol/core').catch(forgetOnFailure(coreSlot))
}

/**
 * Load the MCP stdio transport entry on demand.
 * @returns the stdio transport module, imported once and cached by the module system.
 */
export function loadStdio(): Promise<McpStdio> {
  return stdioSlot.promise ??= import('@modelcontextprotocol/client/stdio').catch(forgetOnFailure(stdioSlot))
}

/**
 * Load the SDK's AJV schema validators on demand.
 * @returns the validator module, imported once and cached by the module system.
 */
export function loadValidators(): Promise<McpValidators> {
  return validatorsSlot.promise ??= import('@modelcontextprotocol/client/validators/ajv').catch(forgetOnFailure(validatorsSlot))
}
