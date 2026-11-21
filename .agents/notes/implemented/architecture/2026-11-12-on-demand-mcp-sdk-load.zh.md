# Agent Note: 按需加载 MCP SDK

Status: implemented

[English](2026-11-12-on-demand-mcp-sdk-load.md) | 中文

## 问题

`dsh-mcp-client` 静态导入了 `@modelcontextprotocol/client`，因此每次 Host 启动都会求值 SDK 与两个传输入口，包括没有配置任何 MCP 服务器的 Host。在已合并的 `custom` 构建上把 mcp-manager 插件图替换为空插件，测得这份启动开销为 11–13 MiB 驻留内存。

## 决策

[`src/sdk.ts`](../../../../packages/mcp/mcp-client/src/sdk.ts) 拥有两个加载器 `loadSdk` 与 `loadStdio`。两者在首次使用时导入各自入口并缓存该 Promise，因此并发连接共用同一次导入，且失败的导入不会留下被缓存的拒绝。连接监督器、探测、工具执行与传输工厂都等待它们；`createTransport` 因此是异步的，因为传输类来自已加载的模块。

单飞（single-flight）是决策的一部分，不是可有可无的缓存。在异步 `vi.mock` 工厂下，对同一模块的两次并发 `import()` 解析结果不一致：一个调用方拿到原模块，另一个拿到 mock。探测用例测得 `['FakeClient', 'Client']`，拿到真实 `Client` 的那次调用从不触发 mock 的 connect，双实例生命周期测试因此挂起到超时。共用一次导入消除了该竞态，同时去掉了工具执行器里每次执行的导入。

## 考虑过的替代方案

**在 `dsh-mcp-manager` 里延迟加载 `dsh-mcp-client`。** 管理器在模块作用域用 mcp-client 的导出构建 `Config` schema 与 `SERVER_NAME_PATTERN`，延迟该包会把 schema 构建与入口校验推到异步边界之后，而启动图并无变化。

**在测试里预热 mock，保留裸导入。** 预热并不能消除竞态：两次顺序的已 mock 导入之后，并发的一对仍解析为 `['FakeClient', 'Client']`。

## 后果

没有配置 MCP 服务器的 Host 不再求值 SDK。本地构建上，`dsh web` 稳定驻留内存从 195–200 MiB 降到 188–191 MiB（各三次，同机同 Node 版本），解析钩子探测在启动时记录到零个 `@modelcontextprotocol/*` 加载，而不是四个。每个连接在首次尝试时付一次 SDK 求值，仍在 `startupTimeoutMs` 之内。
