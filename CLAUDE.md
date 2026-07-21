# Bookplus Booking App — Project Context

## What this is
Appointment-booking platform being restructured into a dual-app
product (customer marketplace + business management app, one backend).
**Read `DUAL_APP_ARCHITECTURE.md` (why/what) and `DUAL_APP_SPEC.md` (how,
epics, acceptance criteria) before working on that initiative.**

## Stack
- Backend: Node/Express, MongoDB/Mongoose, JWT auth (access + rotating refresh,
  `tokenVersion`) — lives in `apps/api` (npm-managed until Epic 1)
- Frontends: React 18 + Vite — `apps/customer` (marketplace, :3002 local,
  app.bookplus.pro + www) and `apps/business` (provider/staff/admin suite,
  :3003 local, business.bookplus.pro). The legacy CRA client is retired.
- Shared packages (pnpm workspace): `packages/design-tokens` (tokens.css +
  tailwind preset — single source of truth for color/type/spacing),
  `packages/api-client` (axios instance + refresh interceptor + domain
  services, TypeScript), `packages/ui` (shared components), `packages/config`
  (shared tsconfig)
- Fonts: Plus Jakarta Sans (display/headings) + Inter (body/UI), self-hosted
  via @fontsource-variable — ALWAYS `var(--font-display)` / `var(--font-body)`,
  never hardcode family names
- Colors: orange `#f03e16`, black `#040505`, white `#e6e8e7`

## Commands
- Install: `pnpm install` (root; covers apps + packages), `npm ci` in `apps/api`
- API dev: `npm run dev` in `apps/api` (or `pnpm api:dev` from root)
- App dev: `pnpm customer:dev` / `pnpm business:dev` — ports 3002/3003, API 5050
  (3000/3001/5000 are taken by other stacks on this machine)
- API tests: `npm test` in `apps/api` (jest, in-memory Mongo)
- E2E: `pnpm --filter @bookplus/customer test:e2e` (playwright; boots its own API)
  and `pnpm --filter @bookplus/business test:e2e` (boots API + both apps)
- Or: `start.bat` → option 3 (starts both servers)

## Workflow
- Dual-app restructure work happens on `feat/dual-app-epic-*` branches via PRs.
  **Never push to main without explicit approval** — push to main is the deploy
  trigger (CI builds images → Docker Hub → SSH auto-deploy).
- Keep the app shippable at every commit; verify each spec task against its
  acceptance criteria before moving on.
- Version bump = `apps/api` + `apps/customer` + `apps/business` package.json
  and an annotated `vX.Y.Z` tag.

## Design system
- All headings: `fontFamily: 'var(--font-display)'`
- CSS variables come from `@bookplus/design-tokens/tokens.css` — never
  redeclare tokens locally
- Cards: white bg, `border: '1px solid var(--border)'`, `borderRadius: 'var(--radius)'`
- Buttons: `className="btn-primary"` / `className="btn-outline"`
- Admin panel: role-gated inside the business app at `/bkplus-command`
  (+ `/insights`) — admins log into business.bookplus.pro

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

This project has a Tree-sitter knowledge graph (`.code-review-graph/`). It is
cheap and gives structural context (callers, dependents, test coverage) that
file scanning cannot — useful for the **React frontends**.

> **⚠️ KNOWN BLIND SPOT — read before trusting an empty result.**
> The extractor does not capture member-expression assignments, and every API
> route handler is written `exports.name = async (req, res) => {}`. That means
> **~154 handlers across 24 controllers are missing from the graph** —
> `createAppointment`, `cancelAppointment` and friends return ZERO hits even
> though they exist. Never read "not in the graph" as "not in the codebase";
> for anything under `apps/api/src/controllers`, use Grep/Read.
>
> Setup note: install into a **venv**, not `pip --user`. The parser probe runs
> in an isolated interpreter (`python -I`) which excludes user site-packages,
> so a `--user` install silently yields a 0-node graph.

### Where graph tools help first (frontend / structure)

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

Use Grep/Glob/Read whenever the graph comes up empty or thin — and always for
the API controllers (see the blind spot above).

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
