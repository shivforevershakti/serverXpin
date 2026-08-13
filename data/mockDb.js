/**
 * Mock "database" for Dynamic Engine.
 *
 * This models the persistence layer a real backend would have: a seeded
 * collection of widget *definitions* (schema/shape + scenario tags), plus an
 * in-memory store of live widget/dashboard *instances*. `/api/generate-dashboard`
 * queries this catalog (never invents widget shapes ad hoc), and `/api/widgets`
 * exposes full CRUD directly over the instance store — so everything rendered
 * on the UI is demonstrably sourced "from the mocked/db via api".
 */

/**
 * Seeded catalog of widget definitions, tagged by scenario so the dashboard
 * generator can query "which widgets apply to this prompt" the same way a
 * real service might filter rows in a `widget_templates` table.
 */
const WIDGET_CATALOG = [
  { key: "metric_api_rate", tags: ["system"], builder: "metricCard", args: ["API Request Rate", "req/sec", "success"] },
  { key: "metric_latency", tags: ["system"], builder: "metricCard", args: ["P95 Latency", "ms", "warning"] },
  { key: "metric_error_rate", tags: ["system"], builder: "metricCard", args: ["Error Rate", "%", "danger"] },
  { key: "metric_high_risk", tags: ["risk"], builder: "metricCard", args: ["High-Risk Accounts", "accounts", "warning"] },
  { key: "metric_critical", tags: ["risk"], builder: "metricCard", args: ["Critical Accounts", "accounts", "danger"] },
  { key: "metric_avg_score", tags: ["risk"], builder: "metricCard", args: ["Avg Risk Score", "score", "success"] },
  { key: "metric_flagged", tags: ["risk"], builder: "metricCard", args: ["Flagged Today", "accounts", "warning"] },
  { key: "table_users", tags: ["system"], builder: "dataTable", args: ["Active User Regions"] },
  { key: "table_risk", tags: ["risk"], builder: "dataTable", args: ["Top Accounts by Risk"] },
  { key: "command_panel", tags: ["always"], builder: "commandPanel", args: ["Actionable Command Panel"] },
  { key: "dynamic_form", tags: ["control"], builder: "dynamicForm", args: ["Agent Parameter Adjuster"] },
  {
    key: "checklist",
    tags: ["default"],
    builder: "checklist",
    args: [
      "Recommended Actions",
      ["Review critical accounts", "Freeze new credit for top segments", "Alert the risk team this week", "Schedule review with relationship managers"],
    ],
  },
  {
    key: "bar_chart",
    tags: ["default"],
    builder: "barChart",
    args: ["Risk Score Distribution", ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "1.0"]],
  },
  {
    key: "pie_chart",
    tags: ["default"],
    builder: "pieChart",
    args: ["Exposure by Region", ["South-East", "West", "Midwest", "North"]],
  },
];

/** Query the catalog for every widget definition matching at least one requested tag. */
function queryCatalogByTags(tags) {
  return WIDGET_CATALOG.filter((entry) => entry.tags.some((tag) => tags.includes(tag)));
}

module.exports = { WIDGET_CATALOG, queryCatalogByTags };
