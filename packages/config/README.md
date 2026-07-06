# @bookplus/config

Shared build/lint configuration for Bookplus apps and packages.

- `tsconfig.base.json` — base TypeScript compiler options; packages extend it via
  `"extends": "@bookplus/config/tsconfig.base.json"`.
- The shared **Vite preset** and **ESLint config** land in Epic 1, when
  `apps/customer` and `apps/business` are scaffolded (DUAL_APP_SPEC.md §5).
