# Agent Note: Mark the covered navigator row instead of matching it with `:has()`

Status: implemented

English | [中文](2026-11-21-navigator-fill-row-attribute.zh.md)

## Problem

Every streaming web session paid a row-wide style recalculation for each inserted chunk. [`FilesBody.module.css`](../../../../packages/client/ui-sidebar-files/src/client/FilesBody.module.css) hid the content a filling workspace navigator covers with `:has(> .navigator.fill) > :not(.navigator)`, plus a second rule for a viewport narrower than 768px. The subject `:not(.navigator)` matches nearly every element, so Blink marked a wide invalidation set "affected by :has()" on each DOM insertion. The trace and A/B measurements in [issue #21](https://github.com/wings1848/morphofly-dsh/issues/21) put a 1800-chunk stream at 25.6s of style recalc in a 63s window and 294 long tasks; deleting the two rules returned it to 2.9s and 3 long tasks.

## Decision

[`face.ts`](../../../../packages/client/ui-sidebar-files/src/client/face.ts) sets `data-files-navigator-fill` on the row it measures while the drawn navigator covers that row: narrower than `FILL_BELOW`, or inside `FULLSCREEN_QUERY`. It removes the attribute when the navigator stops covering the row and in the release that stops measuring it. [`FilesBody.module.css`](../../../../packages/client/ui-sidebar-files/src/client/FilesBody.module.css) hides the covered children through `[data-files-navigator-fill] > :not(.navigator)`, whose only dynamic input is that row attribute, so an insertion invalidates one row instead of the document.

The face already derived the covering condition for its focus handoff, so the attribute reuses that decision instead of adding a second width source. The attribute is the row contract for components that draw a navigator: the navigator's laid-out parent receives it, and `layoutParent` already passes over `display: contents` wrappers.

## Alternatives considered

**Bound the `:has()` subject with a class.** Naming the covered body would leave the same descendant-`:has()` invalidation set on every row. The issue's micro-experiment measured 0.86s for a class-bounded subject against 0.82s for an attribute rule over 600 chunks, and the class would have to be added to every renderer's body.

**Keep `:has()` and qualify its argument.** `.q:has(> .x) > :not(.x)` measured 5.77s against 6.18s: the cost sits in the unbounded subject, not in the `:has()` argument, so bounding the argument buys nothing.

**Reorder the row so the navigator precedes the covered content.** A general-sibling rule then needs no `:has()`, but the hosting preview and page draw the navigator after their own content, and reordering changes layout and tab order in both.

## Consequences

The covered body still stays laid out and leaves the accessibility tree, and the focus handoff is unchanged because it reads the same `fills` value. A row that fills for a reason the face does not measure now stays visible: `FILL_BELOW` and `FULLSCREEN_QUERY` in [`navigator-layout.ts`](../../../../packages/client/ui-sidebar-files/src/client/navigator-layout.ts) are the only conditions the stylesheet and the face share, so a new one has to reach both.

## Testing

[`files-navigator.client.spec.tsx`](../../../../packages/client/ui-sidebar-files/tests/files-navigator.client.spec.tsx) draws a 399px row, a 900px row, and a fullscreen viewport, and asserts the attribute follows each transition and disappears when the navigator closes; [`files-body.client.spec.tsx`](../../../../packages/client/ui-sidebar-files/tests/files-body.client.spec.tsx) asserts the files page's own row never carries it.
