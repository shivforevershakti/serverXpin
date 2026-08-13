/**
 * Real LLM integration for /api/generate-dashboard, backed by Google Gemini.
 *
 * When GEMINI_API_KEY is configured, prompts are sent to Gemini
 * (@google/generative-ai) with a system instruction that pins the exact
 * widget-schema contract our Dynamic Component Registry expects. The model
 * replies with structured JSON, which we validate/normalize into the same
 * dashboard shape produced by the mock generator.
 *
 * If no key is configured, or the LLM call/parsing fails for any reason,
 * `generateDashboardWithLLM` throws — callers should catch this and fall
 * back to the deterministic mock generator so the app keeps working.
 */
const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

let client = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return client;
}

/** Whether a real LLM backend is configured for this server instance. */
function isLLMEnabled() {
//   return Boolean(process.env.GEMINI_API_KEY);
return false;
}

const SYSTEM_PROMPT = `You are Dynamic Engine's dashboard-generation service for a BI analytics portal.
Given a user's natural-language request, respond with ONLY a JSON object (no prose, no markdown fences) matching this exact schema:

{
  "layout": "grid-3-col",
  "theme": "dark" | "light" | "high-contrast",  // default "dark" unless the user explicitly asks for light mode / high-contrast / accessibility mode
  "summary": {
    "headline": string,   // one bold sentence answering the user's question with concrete numbers
    "subtext": string,    // one supporting sentence with more detail
    "badges": string[]    // 2-4 short trust/provenance badges, e.g. "High Confidence", "Sourced from customers_db"
  },
  "widgets": [ ... ]
}

Every "widgets" entry must have: "id" (short unique string), "type", "title", and "data" matching ONE of these archetypes:

1. type "METRIC_CARD" — data: { "value": string, "unit": string, "trend": "+X.X%" or "-X.X%", "status": "success"|"warning"|"danger", "sparkline": number[] (7-12 points) }
2. type "DATA_TABLE" — data: { "columns": [{ "key": string, "label": string, "sortable"?: boolean, "filterable"?: boolean }], "rows": object[] (5-20 rows, keys matching column keys) }
3. type "COMMAND_PANEL" — data: { "fields": [{ "name": string, "label": string, "type": "text"|"slider"|"toggle"|"select", "default": any, "min"?, "max"?, "step"?, "options"?: string[], "required"?: boolean, "validation"?: { "minLength"?, "maxLength"?, "pattern"?, "message"? } }], "actionEndpoint": "/api/widget-action", "submitLabel"?: string }
4. type "DYNAMIC_FORM" — same "data" shape as COMMAND_PANEL (fields + actionEndpoint), used for live parameter/config adjusters rather than one-off commands. "step" is optional on slider fields (omit it for a smooth continuous feel). Example:
   {
     "id": "wgt_02",
     "type": "DYNAMIC_FORM",
     "title": "Agent Parameter Adjuster",
     "data": {
       "fields": [
         { "name": "temperature", "label": "Model Temperature", "type": "slider", "min": 0, "max": 1, "default": 0.7 },
         { "name": "fallbackMode", "label": "Enable Fallback", "type": "toggle", "default": true }
       ],
       "actionEndpoint": "/api/widget-action"
     }
   }
5. type "CHECKLIST" — data: { "actionEndpoint": "/api/widget-action", "items": [{ "id": string, "label": string, "done": boolean }] }
6. type "BAR_CHART" — data: { "bars": [{ "label": string, "value": number }] }
7. type "PIE_CHART" — data: { "slices": [{ "label": string, "value": number }] } (3-6 slices, values need not sum to 100)

Rules:
- ALWAYS include at least one METRIC_CARD (2-4 of them), exactly one DATA_TABLE, and exactly one COMMAND_PANEL — these three archetypes are mandatory.
- Optionally add CHECKLIST / BAR_CHART / PIE_CHART / DYNAMIC_FORM widgets when they fit the request.
- Base all values/labels on the user's request; invent plausible, internally-consistent mock data.
- Output must be strict JSON — no comments, no trailing commas, no markdown.`;

/**
 * Calls Gemini to generate a dashboard schema for `prompt`.
 * Throws if the LLM is not configured, the call fails, or the response
 * cannot be parsed/validated into the expected shape.
 */
async function generateDashboardWithLLM(prompt) {
  const genAI = getClient();
  if (!genAI) throw new Error("LLM not configured (missing GEMINI_API_KEY)");

  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
  });

  const result = await model.generateContent(prompt || "Show me a general analytics overview.");
  const raw = result.response?.text();
  if (!raw) throw new Error("LLM returned an empty response");

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.widgets) || parsed.widgets.length === 0) {
    throw new Error("LLM response missing a non-empty widgets array");
  }

  // Normalize/validate each widget so a malformed LLM reply can't crash the client.
  let seq = 1;
  const widgets = parsed.widgets
    .filter((w) => w && typeof w === "object" && w.type && w.title && w.data)
    .map((w) => ({ id: w.id || `wgt_llm_${seq++}`, type: w.type, title: w.title, data: w.data }));

  if (widgets.length === 0) throw new Error("No valid widgets survived normalization");

  return {
    layout: parsed.layout || "grid-3-col",
    theme: parsed.theme || "dark",
    prompt,
    generatedAt: new Date().toISOString(),
    source: "llm",
    model: MODEL,
    summary: parsed.summary || null,
    widgets,
  };
}

module.exports = { isLLMEnabled, generateDashboardWithLLM };
