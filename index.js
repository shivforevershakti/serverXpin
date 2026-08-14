require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { generateDashboardFromPrompt } = require("./data/widgetFactory");
const { WIDGET_CATALOG } = require("./data/mockDb");
const { isLLMEnabled, generateDashboardWithLLM } = require("./llm/generateWithLLM");

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = [
  "http://localhost:5173",
  "https://dynamic-engine-dashboard-cl.vercel.app",
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

console.log(
  isLLMEnabled()
    ? `LLM integration ENABLED (model: ${process.env.GEMINI_MODEL || "gemini-flash-latest"})`
    : "LLM integration DISABLED (no GEMINI_API_KEY) — falling back to the mock catalog generator"
);

/**
 * In-memory "DB" — dashboards, individual widgets (keyed by id), and a
 * widget-action audit log. Acts as the mocked data store the REST CRUD
 * endpoints below read from and write to.
 */
const db = {
  dashboards: new Map(), // dashboardId -> dashboard payload
  widgets: new Map(), // widgetId -> widget schema
  actionLog: [],
};

let widgetIdSeq = 1000;
const nextWidgetId = () => `wgt_${widgetIdSeq++}`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves a dashboard for `prompt` using the real LLM when configured,
 * falling back to the deterministic mock catalog generator if the LLM is
 * disabled or the call/parsing fails for any reason.
 */
async function resolveDashboard(prompt) {
  if (isLLMEnabled()) {
    try {
      return await generateDashboardWithLLM(prompt);
    } catch (err) {
      console.warn(`[llm] generation failed, falling back to mock: ${err.message}`);
    }
  }
  return { source: "mock", ...generateDashboardFromPrompt(prompt) };
}

/**
 * POST /api/generate-dashboard
 * Body: { prompt: string, stream?: boolean }
 * Calls a real LLM when GEMINI_API_KEY is configured (see ./llm/generateWithLLM.js),
 * otherwise falls back to the mock catalog generator. When `stream` is true, the
 * resulting widgets are flushed one-by-one as newline-delimited JSON (NDJSON)
 * chunks so the client can progressively render widgets as they "arrive".
 */
app.post("/api/generate-dashboard", async (req, res) => {
  const { prompt = "", stream = true } = req.body || {};
  const dashboard = await resolveDashboard(prompt);
  const dashboardId = `dash_${Date.now()}`;
  db.dashboards.set(dashboardId, dashboard);
  // Persist each generated widget into the mocked widget store so it's addressable via the /api/widgets CRUD routes.
  dashboard.widgets.forEach((widget) => db.widgets.set(widget.id, widget));

  if (!stream) {
    await delay(400);
    return res.json({ dashboardId, ...dashboard });
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Transfer-Encoding": "chunked",
    "Cache-Control": "no-cache",
  });

  // First chunk: meta info (layout/theme/summary/source) so the client can mount the shell immediately.
  res.write(
    JSON.stringify({
      kind: "meta",
      dashboardId,
      layout: dashboard.layout,
      theme: dashboard.theme,
      totalWidgets: dashboard.widgets.length,
      summary: dashboard.summary,
      source: dashboard.source,
    }) + "\n"
  );
  await delay(250);

  for (const widget of dashboard.widgets) {
    await delay(300 + Math.random() * 400);
    res.write(JSON.stringify({ kind: "widget", widget }) + "\n");
  }

  res.write(JSON.stringify({ kind: "done", dashboardId }) + "\n");
  res.end();
});

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "dynamic-engine-server",
    llmEnabled: isLLMEnabled(),
    model: isLLMEnabled()
      ? process.env.GEMINI_MODEL || "gemini-flash-latest"
      : null,
  })
);

/**
 * POST /api/widget-action
 * Body: { widgetId, action, payload }
 * Simulates applying a user-driven mutation (form submit, toggle, layout
 * rearrange) to a widget's server-side state. Randomly fails ~12% of the
 * time so the client can exercise optimistic-rollback handling.
 */
app.post("/api/widget-action", async (req, res) => {
  const { widgetId, action, payload } = req.body || {};

  if (!widgetId || !action) {
    return res.status(400).json({ ok: false, error: "widgetId and action are required" });
  }

  await delay(500 + Math.random() * 500);

  const shouldFail = Math.random() < 0.12;
  const entry = { widgetId, action, payload, timestamp: new Date().toISOString(), ok: !shouldFail };
  db.actionLog.push(entry);

  if (shouldFail) {
    return res.status(500).json({ ok: false, error: "Simulated downstream service failure. Please retry." });
  }

  // Persist the mutation onto the mocked widget record so subsequent reads reflect the change.
  const widget = db.widgets.get(widgetId);
  if (widget && payload && typeof payload === "object") {
    widget.data = { ...widget.data, ...payload };
  }

  return res.json({ ok: true, widgetId, action, appliedPayload: payload, appliedAt: entry.timestamp });
});

/** GET /api/dashboards/:id — fetch a previously generated dashboard (CRUD: read) */
app.get("/api/dashboards/:id", (req, res) => {
  const dashboard = db.dashboards.get(req.params.id);
  if (!dashboard) return res.status(404).json({ ok: false, error: "Dashboard not found" });
  res.json({ ok: true, dashboardId: req.params.id, ...dashboard });
});

/** DELETE /api/dashboards/:id — discard a dashboard (CRUD: delete) */
app.delete("/api/dashboards/:id", (req, res) => {
  const existed = db.dashboards.delete(req.params.id);
  res.json({ ok: existed });
});

/**
 * REST CRUD for individual widgets, backed by the in-memory `db.widgets` mock store.
 * GET    /api/widgets       — list all widgets currently in the store
 * GET    /api/widgets/:id   — read a single widget
 * POST   /api/widgets       — create a widget record { type, title, data }
 * PUT    /api/widgets/:id   — replace a widget's title/data
 * PATCH  /api/widgets/:id   — merge-patch a widget's data
 * DELETE /api/widgets/:id   — remove a widget from the store
 */
app.get("/api/widgets", (_req, res) => {
  res.json({ ok: true, widgets: Array.from(db.widgets.values()) });
});

app.get("/api/widgets/:id", (req, res) => {
  const widget = db.widgets.get(req.params.id);
  if (!widget) return res.status(404).json({ ok: false, error: "Widget not found" });
  res.json({ ok: true, widget });
});

app.post("/api/widgets", (req, res) => {
  const { type, title, data } = req.body || {};
  if (!type || !title) {
    return res.status(400).json({ ok: false, error: "type and title are required" });
  }
  const widget = { id: nextWidgetId(), type, title, data: data ?? {} };
  db.widgets.set(widget.id, widget);
  res.status(201).json({ ok: true, widget });
});

app.put("/api/widgets/:id", (req, res) => {
  const existing = db.widgets.get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: "Widget not found" });
  const { type, title, data } = req.body || {};
  const widget = { id: existing.id, type: type ?? existing.type, title: title ?? existing.title, data: data ?? {} };
  db.widgets.set(widget.id, widget);
  res.json({ ok: true, widget });
});

app.patch("/api/widgets/:id", (req, res) => {
  const existing = db.widgets.get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: "Widget not found" });
  const { title, data } = req.body || {};
  const widget = { ...existing, title: title ?? existing.title, data: { ...existing.data, ...(data ?? {}) } };
  db.widgets.set(widget.id, widget);
  res.json({ ok: true, widget });
});

app.delete("/api/widgets/:id", (req, res) => {
  const existed = db.widgets.delete(req.params.id);
  if (!existed) return res.status(404).json({ ok: false, error: "Widget not found" });
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "dynamic-engine-server",
    llmEnabled: isLLMEnabled(),
    model: isLLMEnabled() ? process.env.GEMINI_MODEL || "gemini-flash-latest" : null,
  })
);

/** GET /api/catalog — read-only view of the seeded widget catalog the generator queries. */
app.get("/api/catalog", (_req, res) => {
  res.json({ ok: true, catalog: WIDGET_CATALOG });
});

app.listen(PORT, () => {
  console.log(`Dynamic Engine mock server listening on http://localhost:${PORT}`);
});
module.exports =app;