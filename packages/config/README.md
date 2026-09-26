# @bookplus/config

Shared build/lint configuration for Bookplus apps and packages.

- `tsconfig.base.json` — base TypeScript compiler options; packages extend it via
  `"extends": "@bookplus/config/tsconfig.base.json"`.
- The shared **Vite preset** and **ESLint config** land in Epic 1, when
  `apps/customer` and `apps/business` are scaffolded (DUAL_APP_SPEC.md §5).
- `legal/` — the legal text both apps show, from one source:
  - `company.mjs` — who operates Bookplus (legal name, registration number,
    addresses, phone, email, privacy contact). A `[bracketed]` or empty value
    is treated as missing: it is hidden on the pages ("details coming soon")
    and every production build prints a warning (`buildCheck.mjs`).
  - `privacy.mjs`, `terms.mjs`, `notice.mjs` — Privacy Policy, Terms of
    Service and "Who we are", each with a customer and a business version.
    Rendered by `LegalDocument` in `@bookplus/ui`.
  - `consent.mjs` — the "By continuing you agree…" lines for sign-up paths.
  - `currencies.mjs` — the currency list named in the Terms (an API unit test
    keeps it equal to `apps/api/src/constants/currencies.js`).
