/**
 * MCP SDK accessors: the wire SDK loads on the first connection, never at boot.
 *
 * Every loader is single-flight and shares one in-flight import. A failed
 * import leaves no cached rejection, so the next connection retries it.
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

/** One in-flight SDK import shared by every connection that needs it. */
let sdkLoad: Promise<McpSdk> | undefined

/** One in-flight core import shared by every OAuth record path that needs it. */
let coreLoad: Promise<McpCore> | undefined

/** One in-flight stdio-entry import shared by every stdio connection. */
let stdioLoad: Promise<McpStdio> | undefined

/** One in-flight validator import shared by every tool sync that needs it. */
let validatorsLoad: Promise<McpValidators> | undefined

/**
 * Load the MCP client SDK on demand.
 * @returns the SDK module, imported once and cached by the module system.
 */
export function loadSdk(): Promise<McpSdk> {
  return sdkLoad ??= import('@modelcontextprotocol/client').catch((error: unknown) => {
    sdkLoad = undefined
    throw error
  })
}

/**
 * Load the MCP core protocol schemas on demand.
 * @returns the core module, imported once and cached by the module system.
 */
export function loadCore(): Promise<McpCore> {
  return coreLoad ??= import('@modelcontextprotocol/core').catch((error: unknown) => {
    coreLoad = undefined
    throw error
  })
}

/**
 * Load the MCP stdio transport entry on demand.
 * @returns the stdio transport module, imported once and cached by the module system.
 */
export function loadStdio(): Promise<McpStdio> {
  return stdioLoad ??= import('@modelcontextprotocol/client/stdio').catch((error: unknown) => {
    stdioLoad = undefined
    throw error
  })
}

/**
 * Load the SDK's AJV schema validators on demand.
 * @returns the validator module, imported once and cached by the module system.
 */
export function loadValidators(): Promise<McpValidators> {
  return validatorsLoad ??= import('@modelcontextprotocol/client/validators/ajv').catch((error: unknown) => {
    validatorsLoad = undefined
    throw error
  })
}
