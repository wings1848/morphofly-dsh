/** MCP SDK accessors: the wire SDK loads on first connection, never at boot. */

/** The MCP client SDK module as the connection paths use it. */
export type McpSdk = typeof import('@modelcontextprotocol/client')

/** The MCP stdio transport entry as the transport factory uses it. */
export type McpStdio = typeof import('@modelcontextprotocol/client/stdio')

/** One in-flight SDK import shared by every connection that needs it. */
let sdkLoad: Promise<McpSdk> | undefined

/** One in-flight stdio-entry import shared by every stdio connection. */
let stdioLoad: Promise<McpStdio> | undefined

/**
 * Load the MCP client SDK on demand.
 *
 * Concurrent callers share one import, and a failed import leaves no cached
 * rejection: the next connection retries it.
 * @returns the SDK module, imported once and cached by the module system.
 */
export function loadSdk(): Promise<McpSdk> {
  return sdkLoad ??= import('@modelcontextprotocol/client').catch((error: unknown) => {
    sdkLoad = undefined
    throw error
  })
}

/**
 * Load the MCP stdio transport entry on demand.
 *
 * Concurrent callers share one import, and a failed import leaves no cached
 * rejection: the next stdio connection retries it.
 * @returns the stdio transport module, imported once and cached by the module system.
 */
export function loadStdio(): Promise<McpStdio> {
  return stdioLoad ??= import('@modelcontextprotocol/client/stdio').catch((error: unknown) => {
    stdioLoad = undefined
    throw error
  })
}
