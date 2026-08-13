# Dynamic Engine — Generative AI Dashboard & Widget Builder

An adaptive workspace that renders real-time, customizable UI widgets from structured LLM JSON schemas, with a Node/Express backend (real Gemini integration + deterministic mock fallback) and a React + TypeScript + Tailwind client.

## Repository Structure

```
/server
  index.js           Express app: streaming generate endpoint, widget-action, full widget CRUD
  llm/generateWithLLM.js   Real Gemini call + system-prompt schema contract (used when GEMINI_API_KEY is set)
  data/widgetFactory.js    Deterministic mock generator (fallback path, also used for LLM-disabled dev/testing)
  data/mockDb.js           Seeded widget-template catalog queried by the mock generator ("mocked DB")
/client
  src/components/registry   Dynamic Component Registry + per-widget Error Boundary
  src/components/widgets    METRIC_CARD, DATA_TABLE, DYNAMIC_FORM/COMMAND_PANEL, CHECKLIST, BAR_CHART, PIE_CHART
  src/components/layout     Sidebar, TopBar, GridLayout (drag-and-drop grid), History panel, Skeletons
  src/store                 Zustand stores: dashboard state (streaming + optimistic actions), theme, toasts
  src/hooks/useDrawerA11y.ts   Focus-trap / Escape-to-close / focus-restore for off-canvas drawers
```

## Getting Started

### 1. Backend (`/server`)

```bash
1.cd server
2.npm install
3. create env and paste
"GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-flash-latest  
PORT=4000"
4.npm start        # http://localhost:4000
```

**Optional: enable real LLM generation.** Copy `.env.example` to `.env` and set `GEMINI_API_KEY` (from [Google AI Studio](https://aistudio.google.com/)):

```env
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-flash-latest   # any model your key's tier supports
PORT=4000
```

Without a key, the server automatically falls back to the deterministic mock generator — the app is fully functional either way, and every LLM call is wrapped so a bad key/model/quota error never breaks a request (see [Key UI/UX Trade-offs](#key-uiux-trade-offs)).

Endpoints:
- `POST /api/generate-dashboard` — body `{ prompt: string, stream?: boolean }`. Calls Gemini when configured (falls back to the mock generator on any error), then streams NDJSON chunks (`meta` → `widget` × N → `done`) so the client can progressively mount widgets. Pass `stream: false` for a single JSON response.
- `POST /api/widget-action` — body `{ widgetId, action, payload }`. Simulates applying a form/toggle/reorder mutation server-side, persists the change onto the mocked widget record, and randomly fails ~12% of the time to exercise optimistic rollback.
- `GET /api/dashboards/:id` / `DELETE /api/dashboards/:id` — read/delete a previously generated dashboard (in-memory store).
- Full REST CRUD for individual widgets, backed by the in-memory `db.widgets` mock store (populated automatically whenever a dashboard is generated):
  - `GET /api/widgets` — list all widgets
  - `GET /api/widgets/:id` — read one widget
  - `POST /api/widgets` — create `{ type, title, data }`
  - `PUT /api/widgets/:id` — replace a widget's title/data
  - `PATCH /api/widgets/:id` — merge-patch a widget's data
  - `DELETE /api/widgets/:id` — remove a widget
- `GET /api/catalog` — read-only view of the seeded widget-template catalog the mock generator queries from.
- `GET /api/health` — liveness check; also reports whether the LLM path is enabled and which model is configured.

### 2. Frontend (`/client`)

```bash
cd client
npm install
npm run dev       # http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:4000` (see [vite.config.ts](client/vite.config.ts)), so run both servers concurrently.

## Architecture

### Dynamic Generative UI Registry

[src/components/registry/WidgetRegistry.tsx](client/src/components/registry/WidgetRegistry.tsx) exposes a `type → Component` lookup table (`METRIC_CARD`, `DATA_TABLE`, `DYNAMIC_FORM`/`COMMAND_PANEL`, `CHECKLIST`, `BAR_CHART`, `PIE_CHART`). Each incoming widget schema is resolved to its renderer purely by the `type` string — adding a new archetype means adding one registry entry (component + one line in `data/widgetFactory.js` and the Gemini system prompt), with zero changes to layout/orchestration code. This was exercised live during development when `PIE_CHART` was added end-to-end without touching `GridLayout`, `App`, or the streaming logic.

Every resolved widget is wrapped in a [WidgetErrorBoundary](client/src/components/registry/ErrorBoundary.tsx) so a single malformed payload or component crash is isolated (`role="alert"` fallback card) instead of taking down the rest of the dashboard. Widgets with missing/invalid `id`, `type`, `title`, or `data` fall back to `UnknownWidget` (`role="status"`) rather than throwing.

### LLM Integration & Fallback

[llm/generateWithLLM.js](server/llm/generateWithLLM.js) sends the user's prompt to Gemini with a system instruction that pins the exact widget-schema contract (mandatory `METRIC_CARD` × 2-4, one `DATA_TABLE`, one `COMMAND_PANEL`, optional `CHECKLIST`/`BAR_CHART`/`PIE_CHART`/`DYNAMIC_FORM`). The raw JSON response is parsed, validated (non-empty `widgets` array), and normalized (auto-assigns missing `id`s, drops malformed entries) before ever reaching the client. `index.js`'s `resolveDashboard()` tries the LLM first when configured and transparently falls back to `data/widgetFactory.js` (which queries the seeded catalog in `data/mockDb.js`) on any failure — missing key, network error, bad JSON, quota exhaustion — so a flaky LLM call never breaks the UI.

### Streaming & Layout Shift Prevention (CLS)

The server streams widgets one at a time over NDJSON. The client's first chunk (`meta`) carries `totalWidgets`, which lets [GridLayout](client/src/components/layout/GridLayout.tsx) render fixed-size [skeleton drivers](client/src/components/layout/Skeleton.tsx) for widgets that haven't arrived yet, sized to match each real widget's own pinned height exactly — reserving the correct grid cell so real widgets swap in with (measured, live) near-zero Cumulative Layout Shift. Starting a *new* generation also carries forward the previous widget count as a provisional skeleton estimate instead of resetting to zero, so the grid never momentarily collapses while waiting on the first `meta` chunk.

### Optimistic State Strategy

[dashboardStore.ts](client/src/store/dashboardStore.ts) (Zustand) implements two optimistic actions following the same pattern:
- `applyWidgetAction` — used by checklist toggles and form submissions: (1) immediately patches the widget in local state for instant feedback, (2) fires `POST /api/widget-action` in the background, (3) on success shows a confirmation toast, on failure rolls back to the pre-mutation snapshot and surfaces a non-intrusive error toast (no blocking dialogs, no full dashboard re-fetch).
- `reorderWidgets` — used by drag-and-drop: applies the new widget order instantly, persists it via the same `/api/widget-action` endpoint in the background, and rolls back to the previous order + toasts on failure. Both paths were live-verified (network-intercepted, forced failures) to confirm sub-20ms UI response against a ~600ms simulated network round-trip, and exact state rollback on error.

### Theming (Design Tokens)

Light/Dark/High-Contrast are implemented as CSS Custom Property sets keyed off `[data-theme]` in [index.css](client/src/index.css), mapped into Tailwind's `theme.extend.colors` in [tailwind.config.js](client/tailwind.config.js) (e.g. `bg-surface`, `text-foreground-muted`, `bg-accent`) — so Tailwind utility classes stay theme-aware without any class-list churn. An LLM-generated (or mock) dashboard can also dictate its own theme via the `theme` field in the schema.

### Auto-Layout Matrix & Drag-and-Drop

[GridLayout.tsx](client/src/components/layout/GridLayout.tsx) uses genuine CSS Grid (responsive `grid-cols-1 → sm:grid-cols-2 → lg:grid-cols-4`) for the KPI/secondary rows and Flexbox for the full-width table row, with `@dnd-kit`'s `rectSortingStrategy` powering drag-to-reorder — chosen over Framer Motion's `Reorder` primitive because `Reorder` only computes swap targets along a single axis and breaks in a true multi-column grid. A small grip handle (not the whole card) carries the drag listeners so interactive widget content (sliders, table sort buttons, form inputs) keeps working normally during a drag. `@dnd-kit`'s `KeyboardSensor` makes reordering fully keyboard-operable (Tab to the handle, Space to pick up, Arrow keys to move, Space to drop, Escape to cancel).

### Accessibility

Global `:focus-visible` ring, a skip-to-content link, `role="dialog"`/focus-trap/Escape-to-close/focus-restore on both off-canvas drawers ([useDrawerA11y.ts](client/src/hooks/useDrawerA11y.ts)), proper `role="checkbox"`/`"table"`/`"columnheader"`/`aria-sort`/`aria-live` semantics on the checklist, data table, and toast notifications, and full label/`id` association plus `aria-invalid`/`aria-describedby` on all dynamic form fields.

### Micro-interactions

Framer Motion powers widget mount transitions (fade + slide, verified frame-by-frame via `requestAnimationFrame` polling during a live stream), toast enter/exit (spring physics), animated toggle switches, and the drag-scale/shadow effect; Tailwind `transition-*` utilities handle hover/focus states throughout.

### Table Virtualization

[DataTable.tsx](client/src/components/widgets/DataTable.tsx) implements lightweight windowing by hand (fixed row height + scroll-position-derived visible range + overscan) rather than pulling in a virtualization library, keeping mounted DOM rows constant regardless of dataset size while still supporting client-side sort/filter with proper ARIA table semantics.

## Key UI/UX Trade-offs

- **Hand-rolled table virtualization** instead of `react-window`/`react-virtual` — fewer dependencies for an assessment-scale dataset (tens of rows); a production build with 10k+ rows would swap in a maintained virtualization library.
- **NDJSON streaming over SSE** — simpler to parse on the client with `ReadableStream` + a manual line buffer, and avoids the extra `EventSource` reconnect/event-type machinery that isn't needed for a one-shot generation call.
- **Zustand over Redux/Context** — minimal boilerplate for the cross-cutting stores (dashboard state, theme, toast queue) needed here.
- **Simulated ~12% failure rate on `/api/widget-action`** — deliberately introduced so the optimistic-rollback path is observable during review without needing to kill the server manually.
- **LLM-first with silent fallback, not LLM-required** — the assignment is explicitly a "mock server" exercise; wiring a real LLM was an enhancement, but the app must stay demoable even with no API key, an expired quota, or a deprecated model name (all three were hit during development and are handled by the same `try/catch → mock` path).
- **Toggle fields pulled into the widget header** (top-right, next to the title) rather than stacked in the field list — keeps a short form (e.g. a single toggle + two fields) visually height-matched with sibling widgets like the checklist, instead of leaving obvious dead space.
- **Off-canvas drawers instead of a true modal dialog** for mobile navigation and investigation history — functionally equivalent (backdrop + focus trap + Escape-to-close) without introducing a separate modal component for a single use case.
- **Auto-derived slider `step`** (`(max-min)/100`) when a schema omits it, instead of defaulting to `1` — a coarse default silently rounded fractional defaults like `0.7` on a `0–1` range slider to `1`; this was caught by feeding the assignment's own sample payload through the app and fixed.
