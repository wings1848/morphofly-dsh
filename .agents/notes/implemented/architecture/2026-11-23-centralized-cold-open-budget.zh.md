# Agent Note: 所有物化日志的路径共用一个冷打开预算

Status: implemented

[English](2026-11-23-centralized-cold-open-budget.md) | 中文

## 问题

冷打开的堆护栏只给 `SessionObservationReader.read()` 计价。其余完整物化存储日志的路径全部绕过了它：`SessionCorpus.load` 与 `projectMany` 经 `inspectPersisted`，SQLite 搜索索引构建直接调用自己的 `readColdSessionLog`。模型工具正是通过这些路径访问会话，因此超大会话仍可耗尽宿主堆，而护栏的 `SESSION_QUERY_SESSION_TOO_LARGE` 对真正需要它的工具不可达（[issue #7](https://github.com/wings1848/morphofly-dsh/issues/7)）。

原来的检查只比较一次空闲堆读数，随后在读取前让出线程，于是两个并发打开可以各自用同一份余量通过，并各自物化一份。

## 决策

[`cold-open-budget.ts`](../../../../packages/session-query/session-query/src/cold-open-budget.ts) 为每个 `SessionQueryEngine` 持有一个 `ColdOpenBudget`。预算按 `coldOpenHeapMultiplier` 给存储产物定价，与扣除其它在途读取后剩余空闲堆的 `coldOpenHeapShare` 比较，并在读取前预留该估算值。`reserve` 返回对应的释放函数，所有调用方都在 `finally` 里释放。检查与预留在同一个同步片段完成，JS 线程是唯一修改者，无需加锁。

引擎把同一个实例交给 `SessionObservationReader`、`SessionCorpus`，并通过 protected 访问器交给 `SqliteSessionQueryEngine` 的索引构建。corpus 读取传入列表快照的 `sizeBytes`；SQLite 的条目映射现在也携带 `sizeBytes`。`inspectPersisted` 原样重抛 `SessionQueryError`，因为把它包装成 `SESSION_QUERY_PERSISTENCE_FAILED` 正是护栏在 corpus 路径上不可达的原因。

## 备选方案

**每条路径各留一份护栏。** 每个调用方都要复制估算、份额与文案；副本会漂移，而且任何副本都看不到其它路径的在途读取，并发漏洞依旧。

**把预算放在模块级单例。** 模块级缓存或单例在本架构里没有归属者，会让策略在独立挂载的引擎之间泄漏。

**按未知大小直接整份预留。** 后端不报告 `sizeBytes` 时无法在不读取的情况下定价，按猜测预留会拒绝本可容纳的读取。预算让未定价的读取通过，只给可定价的读取计价。

## 后果

每条物化路径现在都在打开会话之前拒绝超大会话，并发打开共享一份预留。拒绝的文案与错误码与原先单路径护栏完全一致，既有调用方与测试的期望不变。SQLite 索引构建为每个列出会话付一次预留，并在每次读取结束时释放。

#7 仍未完成的部分：经 Gateway 与 Web history controller 的稳定客户端错误码，以及缓存字节预算的边界情况（被租约钉住的条目少算；单个超大的钉住条目无法淘汰）。

## 测试

`cold-open-budget.spec.ts` 覆盖未定价读取、关闭份额、倍数、在途预留使第二次打开失败并在释放后成功、幂等释放，以及拒绝文案。`observation-heap.spec.ts` 继续通过 reader 锁定面向运维的文案。
