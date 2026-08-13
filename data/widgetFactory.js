/**
 * Mock "LLM" widget schema generator.
 * Given a natural-language prompt, deterministically (but pseudo-randomly)
 * builds a structured widget dashboard payload matching the schema contract
 * shared with the frontend Dynamic Component Registry.
 */
const { queryCatalogByTags } = require("./mockDb");

let widgetSeq = 1;
const nextId = () => `wgt_${String(widgetSeq++).padStart(2, "0")}`;

function randTrend() {
  const val = (Math.random() * 24 - 6).toFixed(1);
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val}%`;
}

function randSparkline(points = 12) {
  let last = 30 + Math.random() * 40;
  const arr = [];
  for (let i = 0; i < points; i++) {
    last = Math.max(5, Math.min(100, last + (Math.random() * 30 - 15)));
    arr.push(Math.round(last));
  }
  return arr;
}

function buildMetricCard(title, unit, status = "success") {
  return {
    id: nextId(),
    type: "METRIC_CARD",
    title,
    data: {
      value: (Math.random() * 20000 + 500).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
      unit,
      trend: randTrend(),
      status,
      sparkline: randSparkline(),
    },
  };
}

function buildDataTable(title, rowCount = 24) {
  const isRiskTable = /risk/i.test(title);

  if (isRiskTable) {
    const accounts = ["ABC Manufacturing", "Delta Logistics", "Orion Retail", "Vega Foods", "Nimbus Tech"];
    const regions = ["South-East", "West", "Midwest", "North"];
    const rows = accounts.map((account, i) => ({
      id: `row_${i + 1}`,
      account,
      exposure: `SAR ${(Math.random() * 5 + 1).toFixed(1)}M`,
      score: (Math.random() * 0.3 + 0.65).toFixed(2),
      region: regions[i % regions.length],
    }));

    return {
      id: nextId(),
      type: "DATA_TABLE",
      title,
      data: {
        columns: [
          { key: "account", label: "Account", sortable: true, filterable: true },
          { key: "exposure", label: "Exposure", sortable: true },
          { key: "score", label: "Score", sortable: true },
          { key: "region", label: "Region", sortable: true, filterable: true },
        ],
        rows,
      },
    };
  }

  const regions = ["US-East", "US-West", "EU-Central", "AP-South", "SA-East", "AP-Northeast"];
  const statuses = ["active", "idle", "degraded", "offline"];
  const rows = Array.from({ length: rowCount }).map((_, i) => ({
    id: `row_${i + 1}`,
    user: `user_${1000 + i}`,
    region: regions[i % regions.length],
    sessions: Math.round(Math.random() * 500),
    latencyMs: Math.round(Math.random() * 300 + 20),
    status: statuses[i % statuses.length],
  }));

  return {
    id: nextId(),
    type: "DATA_TABLE",
    title,
    data: {
      columns: [
        { key: "user", label: "User", sortable: true },
        { key: "region", label: "Region", sortable: true, filterable: true },
        { key: "sessions", label: "Sessions", sortable: true },
        { key: "latencyMs", label: "Latency (ms)", sortable: true },
        { key: "status", label: "Status", sortable: true, filterable: true },
      ],
      rows,
    },
  };
}

function buildDynamicForm(title) {
  return {
    id: nextId(),
    type: "DYNAMIC_FORM",
    title,
    data: {
      fields: [
        { name: "temperature", label: "Model Temperature", type: "slider", min: 0, max: 1, step: 0.05, default: 0.7 },
        { name: "maxTokens", label: "Max Tokens", type: "slider", min: 128, max: 4096, step: 128, default: 1024 },
        { name: "fallbackMode", label: "Enable Fallback", type: "toggle", default: true },
        { name: "region", label: "Preferred Region", type: "select", options: ["us-east", "eu-central", "ap-south"], default: "us-east" },
      ],
      actionEndpoint: "/api/widget-action",
    },
  };
}

function buildCommandPanel(title) {
  return {
    id: nextId(),
    type: "COMMAND_PANEL",
    title,
    data: {
      fields: [
        {
          name: "commandName",
          label: "Command Name",
          type: "text",
          required: true,
          default: "",
          validation: { minLength: 3, maxLength: 40, pattern: "^[A-Za-z0-9 _-]+$", message: "3-40 chars, letters/numbers/spaces/-_ only" },
        },
        { name: "priority", label: "Priority", type: "select", options: ["low", "medium", "high", "critical"], default: "medium" },
        { name: "dryRun", label: "Dry Run", type: "toggle", default: true },
      ],
      actionEndpoint: "/api/widget-action",
      submitLabel: "Execute Command",
    },
  };
}

function buildChecklist(title, items) {
  return {
    id: nextId(),
    type: "CHECKLIST",
    title,
    data: {
      actionEndpoint: "/api/widget-action",
      // Recommended actions arrive pre-acknowledged (matches the reference design); still toggleable by the user.
      items: items.map((label, i) => ({ id: `item_${i + 1}`, label, done: true })),
    },
  };
}

function buildBarChart(title, categories) {
  return {
    id: nextId(),
    type: "BAR_CHART",
    title,
    data: {
      bars: categories.map((label) => ({ label, value: Math.round(Math.random() * 80 + 10) })),
    },
  };
}

function buildPieChart(title, categories) {
  return {
    id: nextId(),
    type: "PIE_CHART",
    title,
    data: {
      slices: categories.map((label) => ({ label, value: Math.round(Math.random() * 60 + 10) })),
    },
  };
}

/**
 * Builds the headline investigation summary shown above the widget grid,
 * mirroring a BI-copilot style "answer" derived from the underlying data.
 */
function buildSummary(prompt) {
  const total = Math.round(Math.random() * 4000 + 500);
  const critical = Math.round(total * (0.2 + Math.random() * 0.15));
  const topAccount = ["ABC Manufacturing", "Delta Logistics", "Orion Retail"][Math.floor(Math.random() * 3)];
  const region = ["South-East", "West", "Midwest", "North"][Math.floor(Math.random() * 4)];
  const share = (Math.random() * 6 + 6).toFixed(1);

  return {
    headline: `${total.toLocaleString()} accounts are high-risk — ${critical.toLocaleString()} are critical.`,
    subtext: `Concentrated in the ${region}; ${topAccount} has the largest exposure at ${share}%.`,
    badges: ["High Confidence", "Sourced from customers_db · 4 tables", "Audit-logged"],
  };
}

/** Builder-name -> hydration-function lookup used when materializing catalog entries. */
const BUILDERS = {
  metricCard: buildMetricCard,
  dataTable: buildDataTable,
  dynamicForm: buildDynamicForm,
  commandPanel: buildCommandPanel,
  checklist: buildChecklist,
  barChart: buildBarChart,
  pieChart: buildPieChart,
};

/**
 * Infers the requested theme from prompt keywords, mirroring what an LLM
 * would infer from a natural-language request (e.g. "light mode", "high
 * contrast" / "accessibility"). Defaults to "dark".
 */
function inferThemeFromPrompt(p) {
  if (/high[\s-]?contrast|accessib/.test(p)) return "high-contrast";
  if (/light\s?(mode|theme)?/.test(p)) return "light";
  return "dark";
}

/**
 * Very small "intent classifier" so different prompts render different widget mixes.
 * This is a mock stand-in for an actual LLM function-calling / structured-output response.
 */
function generateDashboardFromPrompt(prompt = "") {
  widgetSeq = 1;
  const p = prompt.toLowerCase();

  const isRiskFlavor = /risk|account|customer/.test(p);
  const wantsUsers = /user|region|session|traffic/.test(p) || isRiskFlavor;
  const wantsSystem = /system|analytics|performance|api|latency|request/.test(p);
  const wantsControl = /agent|config|parameter|command|control|action/.test(p);

  // Resolve the prompt to a set of scenario tags, then query the mocked widget
  // catalog for every definition matching those tags — the rendered dashboard
  // is always assembled from records read out of the mock "database".
  const scenarioTags = ["always"];
  scenarioTags.push(wantsSystem || (!wantsUsers && !wantsControl) ? "system" : "risk");
  scenarioTags.push(wantsControl ? "control" : "default");

  const widgets = queryCatalogByTags(scenarioTags).map((entry) => {
    const build = BUILDERS[entry.builder];
    return build(...entry.args);
  });

  return {
    layout: "grid-3-col",
    theme: inferThemeFromPrompt(p),
    prompt,
    generatedAt: new Date().toISOString(),
    summary: buildSummary(prompt),
    widgets,
  };
}

module.exports = {
  generateDashboardFromPrompt,
  buildMetricCard,
  buildDataTable,
  buildDynamicForm,
  buildCommandPanel,
  buildChecklist,
  buildBarChart,
  buildPieChart,
};
