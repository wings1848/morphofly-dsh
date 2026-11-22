# Agent Note: 标记被覆盖的导航栏行，而不是用 `:has()` 匹配它

Status: implemented

[English](2026-11-21-navigator-fill-row-attribute.md) | 中文

## 问题

每条流式 Web 会话都会为每个插入的 chunk 付一次整行量级的样式重算。[`FilesBody.module.css`](../../../../packages/client/ui-sidebar-files/src/client/FilesBody.module.css) 用 `:has(> .navigator.fill) > :not(.navigator)` 隐藏铺满导航栏所覆盖的内容，另有一条针对视口窄于 768px 的规则。主语 `:not(.navigator)` 几乎匹配所有元素，于是 Blink 在每次 DOM 插入时把大范围失效集标记为 “affected by :has()”。[issue #21](https://github.com/wings1848/morphofly-dsh/issues/21) 的 trace 与 A/B 实测把 1800 chunk 的流记为 63 秒窗口内 25.6 秒样式重算、294 次 long task；删掉这两条规则后回到 2.9 秒与 3 次。

## 决策

[`face.ts`](../../../../packages/client/ui-sidebar-files/src/client/face.ts) 在绘制中的导航栏覆盖所在行期间，给它测量到的行写 `data-files-navigator-fill`：行窄于 `FILL_BELOW`，或视口命中 `FULLSCREEN_QUERY` 时。导航栏不再覆盖该行时移除属性，停止测量该行的释放函数里也移除。[`FilesBody.module.css`](../../../../packages/client/ui-sidebar-files/src/client/FilesBody.module.css) 通过 `[data-files-navigator-fill] > :not(.navigator)` 隐藏被覆盖的子元素；该规则唯一的动态输入是这一个行属性，因此一次插入只让一行失效，而不是整个文档。

face 本来就要为焦点交接推导这份覆盖条件，属性复用它，而不是引入第二个宽度来源。该属性是给绘制导航栏的组件用的行契约：导航栏经过布局的父元素会收到它，而 `layoutParent` 本来就会越过 `display: contents` 包装层。

## 备选方案

**用类名收窄 `:has()` 的主语。** 给被覆盖的正文一个类名，仍会在每一行留下同样的后代 `:has()` 失效集。issue 的微实验中，600 chunk 下类名收窄的主语为 0.86 秒，属性规则为 0.82 秒；而且每个渲染器的正文都要加这个类。

**保留 `:has()` 并限定它的参数。** `.q:has(> .x) > :not(.x)` 实测 5.77 秒对 6.18 秒：代价在无界的主语上，不在 `:has()` 的参数里，限定参数没有收益。

**把导航栏调整到被覆盖内容之前。** 一般兄弟选择器就不再需要 `:has()`，但宿主预览页与文件页都把导航栏画在自己内容之后，调整顺序会同时改变两者的布局与 Tab 顺序。

## 后果

被覆盖的正文仍然保持布局、离开无障碍树；焦点交接不变，因为它读的是同一个 `fills` 值。face 不测量的原因导致铺满的行，现在会保持可见：[`navigator-layout.ts`](../../../../packages/client/ui-sidebar-files/src/client/navigator-layout.ts) 中的 `FILL_BELOW` 与 `FULLSCREEN_QUERY` 是样式表与 face 唯一共享的条件，新增条件必须同时落到两边。

## 测试

[`files-navigator.client.spec.tsx`](../../../../packages/client/ui-sidebar-files/tests/files-navigator.client.spec.tsx) 依次绘制 399px 行、900px 行与全屏视口，断言属性跟随每次切换、并在导航栏关闭时消失；[`files-body.client.spec.tsx`](../../../../packages/client/ui-sidebar-files/tests/files-body.client.spec.tsx) 断言文件页自己的行从不携带该属性。
