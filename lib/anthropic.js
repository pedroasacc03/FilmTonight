// Thin wrapper around the Anthropic SDK. Every other lib/*.js file that
// needs Claude (profile.js, recommendations.js, chat.js) goes through here,
// so there's exactly one place that knows how to talk to the API, parse its
// JSON responses, and give a clear error if the API key is missing.
// (lib/titles.js used to be a caller too - title lookups now go through
// TMDB/OMDb directly instead, see that file for why.)

import Anthropic from "@anthropic-ai/sdk";

let cachedClient = null;

export function getClaudeClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your Anthropic API key " +
        "(get one at https://console.anthropic.com/settings/keys)."
    );
  }
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return cachedClient;
}

// The model used for every Claude call in this app (profile synthesis,
// recommendation/Surprise Me candidate generation, and the chatbot - see
// lib/profile.js, lib/recommendations.js, lib/chat.js). There used to be a
// second, cheaper tier (Haiku) for chat/recommendations, with this model
// reserved for profile synthesis only - removed after head-to-head testing
// (same scenarios, both models, every claimed action checked against the
// database) found Haiku would occasionally claim to have made a data edit
// it never actually made, sometimes even fabricating a supporting detail to
// back up the false claim. That failure mode is worse than the cost/latency
// this model costs relative to Haiku, for a feature whose entire point is
// giving the user - and the chatbot - trustworthy read/write access to real
// data. Env var name predates the single-tier setup; kept as-is rather than
// renamed, so existing deployments don't need to touch their config.
export function getProfileModel() {
  return process.env.CLAUDE_PROFILE_MODEL || "claude-sonnet-5";
}

// Per-million-token pricing for claude-sonnet-5 (the only model this app
// calls - see getProfileModel above). Hardcoded rather than fetched live:
// Anthropic doesn't expose per-token pricing via an API, so this has to be
// kept in sync by hand if pricing changes. Cache write/read are priced as a
// multiplier of the base input rate (1.25x / 0.1x) - standard across
// Anthropic's models - for the 5-minute ephemeral TTL, which is the only
// TTL this app uses (every cache_control call site omits `ttl`, so it
// defaults to 5m - see lib/profile.js and lib/chat.js). If this app ever
// opts into 1-hour caching, its write cost is priced differently (2x, not
// 1.25x) and this constant would need a second write rate.
const PRICE_PER_MTOK_USD = {
  input: 2.0,
  output: 10.0,
  cacheWrite: 2.5, // 1.25x input
  cacheRead: 0.2, // 0.1x input
};

// Turns a Claude API response's `usage` object into a USD cost, using the
// pricing above. Used to attach real dollar figures to the cost-tracking
// events in lib/events.js (see trackCostEvent) - see app/admin/metrics for
// where those get aggregated and displayed.
export function computeCostUsd(usage) {
  if (!usage) return 0;
  const { input_tokens = 0, output_tokens = 0, cache_creation_input_tokens = 0, cache_read_input_tokens = 0 } = usage;
  return (
    (input_tokens * PRICE_PER_MTOK_USD.input +
      output_tokens * PRICE_PER_MTOK_USD.output +
      cache_creation_input_tokens * PRICE_PER_MTOK_USD.cacheWrite +
      cache_read_input_tokens * PRICE_PER_MTOK_USD.cacheRead) /
    1_000_000
  );
}

// Adds up several `usage` objects into one - for a feature that makes more
// than one Claude call per user-visible action (the chatbot's tool-use loop
// in lib/chat.js, and generateSurprisePick's retry-on-collision in
// lib/recommendations.js), so the cost tracked reflects the full cost of
// that one action, not just its last API call.
export function sumUsage(usageList) {
  return usageList.reduce(
    (acc, u) => ({
      input_tokens: acc.input_tokens + (u?.input_tokens || 0),
      output_tokens: acc.output_tokens + (u?.output_tokens || 0),
      cache_creation_input_tokens: acc.cache_creation_input_tokens + (u?.cache_creation_input_tokens || 0),
      cache_read_input_tokens: acc.cache_read_input_tokens + (u?.cache_read_input_tokens || 0),
    }),
    { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  );
}

// Pulls all plain-text content blocks out of a Claude response and joins
// them. Claude's response can also contain tool-use/tool-result blocks
// (e.g. when web search was used), which we skip here since we only want
// the final written answer.
export function extractText(message) {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

// Claude usually returns clean JSON when asked to, but sometimes wraps it in
// a ```json ... ``` markdown code fence anyway, or narrates before/after it
// ("Based on my search, here are the candidates:\n[...]") despite being told
// not to. This strips a fence if present, then - if that's still not valid
// JSON - falls back to extracting the outermost [...]/{...} substring, and
// only then throws a clear error (including the raw text), which is much
// easier to debug than a generic "Unexpected token" error.
export function parseJSONLoose(text) {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const firstBracket = cleaned.search(/[[{]/);
    if (firstBracket !== -1) {
      const closeChar = cleaned[firstBracket] === "[" ? "]" : "}";
      const lastBracket = cleaned.lastIndexOf(closeChar);
      if (lastBracket > firstBracket) {
        try {
          return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
        } catch {
          // fall through to the error below
        }
      }
    }
    throw new Error(
      `Claude's response wasn't valid JSON. Raw response:\n${text}\n\nParse error: ${err.message}`
    );
  }
}

// Ask Claude a question and parse the reply as JSON. No web search - use
// this for reasoning over data we already have (e.g. building a preference
// profile from a user's ratings).
//
// thinking is explicitly disabled: this is direct structured-JSON extraction,
// not a task that benefits from extended reasoning, and on models where
// adaptive thinking is on by default (e.g. Sonnet 5) it silently eats the
// entire max_tokens budget - stop_reason: "max_tokens" with 100% of the
// tokens spent on thinking and none left for the actual response.
// `model` is required - callers always pass getProfileModel() explicitly
// (there's only the one tier now, but naming it at the call site keeps it
// obvious which model a given feature runs on, without a hidden default to
// forget about here).
//
// `cacheSystemPrompt` opts into Anthropic prompt caching for this call's
// system prompt (default off - only worth it where the system prompt is
// both fully static and long enough to clear the model's minimum cacheable
// prefix; Sonnet 5's is 1024 tokens. lib/recommendations.js's system
// prompts are fully static but too short (~300-450 tokens) to clear it, so
// they don't bother; lib/profile.js's is the one place here that both
// qualifies and uses it).
// Returns { data, usage } rather than just the parsed data - `usage` is the
// raw Claude API usage object (input_tokens/output_tokens/
// cache_creation_input_tokens/cache_read_input_tokens), needed by every
// caller so it can track that call's real token cost (see lib/events.js
// trackCostEvent and lib/anthropic.js computeCostUsd).
//
// If parseJSONLoose fails (Claude occasionally returns near-JSON that isn't
// quite valid - e.g. a stray `.map(function(){})` tacked onto an array
// literal, seen in testing), the tokens were still generated and billed by
// the API before parsing ever ran - only the parsing step failed, not the
// call. So `usage` is attached to the thrown error (`err.usage`) rather
// than lost, letting every caller still track that call's real cost in its
// catch block before re-throwing - see lib/profile.js/lib/recommendations.js
// for the try/catch/finally pattern that does this.
export async function askClaudeForJSON({ system, prompt, maxTokens = 2000, model, cacheSystemPrompt = false }) {
  const client = getClaudeClient();
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    thinking: { type: "disabled" },
    system: cacheSystemPrompt ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system,
    messages: [{ role: "user", content: prompt }],
  });
  try {
    return { data: parseJSONLoose(extractText(message)), usage: message.usage };
  } catch (err) {
    err.usage = message.usage;
    throw err;
  }
}
