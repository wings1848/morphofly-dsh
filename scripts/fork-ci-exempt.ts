/**
 * Suites a standard GitHub-hosted runner cannot execute: they need kernel
 * confinement (`sandbox`), `gh`, or git-worktree timing that only the
 * upstream enterprise and self-hosted matrix provides. The fork's advisory
 * unit lane sets {@link FORK_CI_EXEMPT_ENV} to drop them.
 *
 * `vitest --exclude` cannot express this: as documented in
 * `scripts/coverage-exempt.ts`, the flag does not reach per-project include
 * resolution, so the suites still ran and failed on capability, not behavior.
 */

/** Set to `1` by the fork's advisory unit lane; `vitest.config.ts` then drops {@link forkCiExemptExcludes}. */
export const FORK_CI_EXEMPT_ENV = 'DSH_FORK_CI_EXEMPT'

/** Exclude globs for the suites the hosted runner cannot run, removed from every project. */
export const forkCiExemptExcludes: readonly string[] = [
  'packages/sandbox/**',
  'packages/ptc-runtime/ptc-runtime-node/**',
  'packages/workflow/workflow-ptc/**',
  'packages/experimental/client-ui-forge/**',
  'packages/experimental/forge-github/**',
]
