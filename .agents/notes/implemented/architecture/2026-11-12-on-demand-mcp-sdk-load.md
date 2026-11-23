# Agent Note: Load the MCP SDK on demand

Status: implemented

English | [中文](2026-11-12-on-demand-mcp-sdk-load.zh.md)

## Problem

`dsh-mcp-client` imported `@modelcontextprotocol/client` statically, so every Host boot evaluated the SDK and both transport entries, including a Host with no MCP server configured. Stubbing the mcp-manager plugin graph on the merged `custom` build put that boot cost at 11–13 MiB of settled RSS.

## Decision

[`src/sdk.ts`](../../../../packages/mcp/mcp-client/src/sdk.ts) owns four loaders — `loadSdk`, `loadCore`, `loadStdio`, and `loadValidators` — covering the split `@modelcontextprotocol/*` entries. Each imports its entry on first use and caches the promise, so concurrent connections share one import and a failed import leaves no cached rejection. The connection supervisor, the probe, the tool bridge, the OAuth record and refresh paths, and the transport factory await them; `createTransport` is asynchronous because the transport class comes from the loaded module.

[`src/diagnostic.ts`](../../../../packages/mcp/mcp-client/src/diagnostic.ts) classifies SDK failures by the SDK's own `Symbol.for('mcp.sdk.errorBrands')` brands instead of importing its error classes, so error reporting cannot reintroduce a boot import. The SDK's `SdkErrorCode` and `OAuthErrorCode` wire values stay literal for the same reason, and the tool bridge loads `specTypeSchemas` and the AJV validators on first use.

Single-flight is part of the decision, not an optional cache. Two concurrent `import()` calls of the same module under an asynchronous `vi.mock` factory resolve inconsistently: one caller receives the original module while the other receives the mock. A probe spec measured `['FakeClient', 'Client']`, and the resulting real `Client` never called the mock's connect, so the two-instance lifecycle test hung until its timeout. One shared import removes that race, and it also removes a per-execution import in the tool executor.

## Alternatives considered

**Lazy-load `dsh-mcp-client` from `dsh-mcp-manager`.** The manager builds its `Config` schema and `SERVER_NAME_PATTERN` from mcp-client exports at module scope, so deferring the package moves schema construction and entry validation behind an asynchronous boundary for the same boot graph.

**Warm the mock in tests and keep bare imports.** A warm-up does not settle the race: after two sequential mocked imports, a concurrent pair still resolved to `['FakeClient', 'Client']`.

## Consequences

A Host with no MCP server never evaluates the SDK. On the local build that motivated the change, settled `dsh web` RSS fell from 195–200 MiB to 188–191 MiB (three runs each, same machine and Node version), and a resolve-hook probe recorded no `@modelcontextprotocol/*` load at boot instead of four. Each connection pays the SDK evaluation once on its first attempt, still inside `startupTimeoutMs`. The same shape applies to the split `client`/`core` packages shipped with 0.2.3: a measured first import of `@modelcontextprotocol/client` costs about 255–400 ms and 8.2 MiB of heap, paid only when a server actually connects.
