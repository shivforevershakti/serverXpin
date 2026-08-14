require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { generateDashboardFromPrompt } = require("./data/widgetFactory");
const { WIDGET_CATALOG } = require("./data/mockDb");
const {
  isLLMEnabled,
  generateDashboardWithLLM,
} = require("./llm/generateWithLLM");

const app = express();

const PORT = process.env.PORT || 4000;

/**
 * Allowed frontend origins
 */
const allowedOrigins = [
  "http://localhost:5173",
  "https://dynamic-engine-dashboard-cl.vercel.app",
];

/**
 * CORS
 */
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without an Origin header
      // e.g. curl, Postman, server-to-server
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn(`CORS blocked origin: ${origin}`);

      return callback(
        new Error(`CORS policy does not allow this origin: ${origin}`)
      );
    },

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],

    credentials: false,

    optionsSuccessStatus: 204,
  })
);

app.use(express.json());

/**
 * Handle CORS preflight explicitly.
 */
app.options("*", cors());

/**
 * Startup log
 */
console.log(
  isLLMEnabled()
    ? `LLM integration ENABLED (model: ${
        process.env.GEMINI_MODEL || "gemini-flash-latest"
      })`
    : "LLM integration DISABLED (no GEMINI_API_KEY) — falling back to mock catalog generator"
);

/**
 * In-memory database
 */
const db = {
  dashboards: new Map(),
  widgets: new Map(),
  actionLog: [],
};

let widgetIdSeq = 1000;

const nextWidgetId = () => `wgt_${widgetIdSeq++}`;

/**
 * Utility delay
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate dashboard
 */
async function resolveDashboard(prompt) {
  if (isLLMEnabled()) {
    try {
      return await generateDashboardWithLLM(prompt);
    } catch (err) {
      console.warn(
        `[llm] generation failed, falling back to mock: ${err.message}`
      );
    }
  }

  return {
    source: "mock",
    ...generateDashboardFromPrompt(prompt),
  };
}

/**
 * =========================================================
 * HEALTH
 * =========================================================
 */
app.get("/api/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "dynamic-engine-server",
    environment: process.env.VERCEL ? "vercel" : "local",
    llmEnabled: isLLMEnabled(),
    model: isLLMEnabled()
      ? process.env.GEMINI_MODEL || "gemini-flash-latest"
      : null,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Root endpoint
 */
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "dynamic-engine-server",
    message: "Dynamic Engine API is running",
  });
});

/**
 * =========================================================
 * GENERATE DASHBOARD
 * =========================================================
 */
app.post("/api/generate-dashboard", async (req, res) => {
  try {
    const {
      prompt = "",
      stream = true,
    } = req.body || {};

    const dashboard = await resolveDashboard(prompt);

    const dashboardId = `dash_${Date.now()}`;

    db.dashboards.set(dashboardId, dashboard);

    /**
     * Save widgets
     */
    dashboard.widgets.forEach((widget) => {
      db.widgets.set(widget.id, widget);
    });

    /**
     * Non-streaming response
     */
    if (!stream) {
      await delay(400);

      return res.status(200).json({
        dashboardId,
        ...dashboard,
      });
    }

    /**
     * Streaming NDJSON response
     */
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Transfer-Encoding": "chunked",
    });

    /**
     * Meta chunk
     */
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

    /**
     * Widget chunks
     */
    for (const widget of dashboard.widgets) {
      await delay(300 + Math.random() * 400);

      res.write(
        JSON.stringify({
          kind: "widget",
          widget,
        }) + "\n"
      );
    }

    /**
     * Done chunk
     */
    res.write(
      JSON.stringify({
        kind: "done",
        dashboardId,
      }) + "\n"
    );

    res.end();
  } catch (error) {
    console.error("generate-dashboard error:", error);

    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,
        error: error.message || "Dashboard generation failed",
      });
    }

    res.end();
  }
});

/**
 * =========================================================
 * WIDGET ACTION
 * =========================================================
 */
app.post("/api/widget-action", async (req, res) => {
  try {
    const {
      widgetId,
      action,
      payload,
    } = req.body || {};

    if (!widgetId || !action) {
      return res.status(400).json({
        ok: false,
        error: "widgetId and action are required",
      });
    }

    await delay(500 + Math.random() * 500);

    /**
     * Simulate failure ~12%
     */
    const shouldFail = Math.random() < 0.12;

    const entry = {
      widgetId,
      action,
      payload,
      timestamp: new Date().toISOString(),
      ok: !shouldFail,
    };

    db.actionLog.push(entry);

    if (shouldFail) {
      return res.status(500).json({
        ok: false,
        error:
          "Simulated downstream service failure. Please retry.",
      });
    }

    /**
     * Update widget
     */
    const widget = db.widgets.get(widgetId);

    if (
      widget &&
      payload &&
      typeof payload === "object"
    ) {
      widget.data = {
        ...widget.data,
        ...payload,
      };
    }

    return res.status(200).json({
      ok: true,
      widgetId,
      action,
      appliedPayload: payload,
      appliedAt: entry.timestamp,
    });
  } catch (error) {
    console.error("widget-action error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Widget action failed",
    });
  }
});

/**
 * =========================================================
 * DASHBOARDS
 * =========================================================
 */

/**
 * GET dashboard
 */
app.get("/api/dashboards/:id", (req, res) => {
  const dashboard = db.dashboards.get(req.params.id);

  if (!dashboard) {
    return res.status(404).json({
      ok: false,
      error: "Dashboard not found",
    });
  }

  return res.json({
    ok: true,
    dashboardId: req.params.id,
    ...dashboard,
  });
});

/**
 * DELETE dashboard
 */
app.delete("/api/dashboards/:id", (req, res) => {
  const existed = db.dashboards.delete(req.params.id);

  return res.json({
    ok: existed,
  });
});

/**
 * =========================================================
 * WIDGET CRUD
 * =========================================================
 */

/**
 * GET all widgets
 */
app.get("/api/widgets", (_req, res) => {
  return res.json({
    ok: true,
    widgets: Array.from(db.widgets.values()),
  });
});

/**
 * GET widget
 */
app.get("/api/widgets/:id", (req, res) => {
  const widget = db.widgets.get(req.params.id);

  if (!widget) {
    return res.status(404).json({
      ok: false,
      error: "Widget not found",
    });
  }

  return res.json({
    ok: true,
    widget,
  });
});

/**
 * CREATE widget
 */
app.post("/api/widgets", (req, res) => {
  const {
    type,
    title,
    data,
  } = req.body || {};

  if (!type || !title) {
    return res.status(400).json({
      ok: false,
      error: "type and title are required",
    });
  }

  const widget = {
    id: nextWidgetId(),
    type,
    title,
    data: data ?? {},
  };

  db.widgets.set(widget.id, widget);

  return res.status(201).json({
    ok: true,
    widget,
  });
});

/**
 * PUT widget
 */
app.put("/api/widgets/:id", (req, res) => {
  const existing = db.widgets.get(req.params.id);

  if (!existing) {
    return res.status(404).json({
      ok: false,
      error: "Widget not found",
    });
  }

  const {
    type,
    title,
    data,
  } = req.body || {};

  const widget = {
    id: existing.id,
    type: type ?? existing.type,
    title: title ?? existing.title,
    data: data ?? {},
  };

  db.widgets.set(widget.id, widget);

  return res.json({
    ok: true,
    widget,
  });
});

/**
 * PATCH widget
 */
app.patch("/api/widgets/:id", (req, res) => {
  const existing = db.widgets.get(req.params.id);

  if (!existing) {
    return res.status(404).json({
      ok: false,
      error: "Widget not found",
    });
  }

  const {
    title,
    data,
  } = req.body || {};

  const widget = {
    ...existing,
    title: title ?? existing.title,
    data: {
      ...existing.data,
      ...(data ?? {}),
    },
  };

  db.widgets.set(widget.id, widget);

  return res.json({
    ok: true,
    widget,
  });
});

/**
 * DELETE widget
 */
app.delete("/api/widgets/:id", (req, res) => {
  const existed = db.widgets.delete(req.params.id);

  if (!existed) {
    return res.status(404).json({
      ok: false,
      error: "Widget not found",
    });
  }

  return res.json({
    ok: true,
  });
});

/**
 * =========================================================
 * CATALOG
 * =========================================================
 */
app.get("/api/catalog", (_req, res) => {
  return res.json({
    ok: true,
    catalog: WIDGET_CATALOG,
  });
});

/**
 * =========================================================
 * ERROR HANDLER
 * =========================================================
 */
app.use((err, _req, res, _next) => {
  console.error("Server error:", err);

  if (err.message?.startsWith("CORS policy")) {
    return res.status(403).json({
      ok: false,
      error: err.message,
    });
  }

  return res.status(500).json({
    ok: false,
    error: err.message || "Internal server error",
  });
});

/**
 * =========================================================
 * LOCAL SERVER
 * =========================================================
 *
 * When running locally:
 *   node index.js
 *
 * On Vercel, Vercel imports the Express app.
 */
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(
      `Dynamic Engine server listening on http://localhost:${PORT}`
    );
  });
}

module.exports = app;