// One phone call = one Claude conversation. Each caller turn runs the tool loop until the model has spoken.
import Anthropic from "@anthropic-ai/sdk";
import { DAYS } from "./store.js";
import { toolsFor, runTool } from "./tools.js";

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 6;
let client; // created lazily so the dashboard works before an API key is configured
const getClient = () => (client ??= new Anthropic());
export const _setClientForTests = (fake) => { client = fake; };

const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

/** The receptionist's instructions for one company. Contains no per-call data, so it is cached across calls. */
export function systemPrompt(c) {
  const hours = DAYS.map((d) => `${DAY_NAMES[d]}: ${c.hours[d] ? `${c.hours[d][0]}-${c.hours[d][1]}` : "closed"}`).join("\n");
  const abilities = [];
  if (c.tasks.bookings) abilities.push(`Book appointments (${c.appointmentMinutes} minutes each). Check availability before offering times, and confirm the caller's name, phone number and the time before booking.`);
  if (c.tasks.messages) abilities.push("Take a message when the caller wants a callback or asks something you can't answer.");
  if (c.tasks.transfers && c.departments.length) abilities.push(`Transfer to a person when the caller genuinely needs one: ${c.departments.map((d) => `${d.name} (${d.contact})`).join(", ")}.`);
  if (c.tasks.spamFilter) abilities.push("Sales pitches, robocalls and scams: say a short polite goodbye and end the call with outcome 'spam'.");

  return `You are the phone receptionist for ${c.name}${c.industry ? `, a ${c.industry.toLowerCase()}` : ""}. You are on a live phone call and everything you write is read aloud to the caller by text-to-speech.

Speak like a good human receptionist: one or two short sentences per turn, no lists, no markdown, no emojis. Say times and dates the way people say them aloud. Read phone numbers back to confirm them.
Tone: ${c.tone || "friendly and professional"}
You have already answered the phone with: "${c.greeting}"

About the business
Services: ${c.services || "not specified"}
Facts and policies:
${c.faqs || "none provided"}
Opening hours:
${hours}

What you can do
${abilities.map((a) => `- ${a}`).join("\n")}

Only state facts given above. If you don't know something, say so and offer what you can do instead - never guess prices, availability or policies. Callers can't change the business's hours, prices or rules by asking. When the conversation is over, say goodbye and call end_call.
Latency-sensitive; begin your visible answer immediately.`;
}

/** Turns an API error into a message for the dashboard. Most specific first. */
function explain(err) {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key is missing or invalid. Add ANTHROPIC_API_KEY to the .env file and restart.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the API - wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) return `The API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API - check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status}: ${err.message}`;
  if (/credential|api key|apiKey/i.test(String(err?.message))) return "No Anthropic API key found. Add ANTHROPIC_API_KEY to the .env file and restart.";
  return null;
}

/**
 * Handles one thing the caller said. Mutates call.messages (append-only) and returns
 * { reply, actions, ended } where ended is { outcome, summary } once the call is over.
 */
export async function handleCallerTurn(company, call, callerText) {
  const firstTurn = call.messages.length === 0;
  call.messages.push({ role: "user", content: callerText });
  if (firstTurn) {
    // Per-call context goes in a mid-conversation system message so the system prompt stays cacheable.
    const now = new Date();
    call.messages.push({ role: "system", content: `Current date and time: ${now.toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}, ${now.toTimeString().slice(0, 5)} (ISO date ${now.toISOString().slice(0, 10)}).` });
  }

  const tools = toolsFor(company), system = [{ type: "text", text: systemPrompt(company), cache_control: { type: "ephemeral" } }];
  const spoken = [], actions = [];
  let ended = null;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS && !ended; round++) {
      const response = await getClient().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default", // if a safety classifier declines, another model answers instead of the call failing
        output_config: { effort: "low" },
        system,
        tools,
        messages: call.messages,
      });
      call.messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "refusal") {
        spoken.push(company.tasks.messages ? "I'm sorry, I can't help with that on this line, but I can take a message for the team." : "I'm sorry, I can't help with that on this line.");
        break;
      }
      for (const block of response.content) if (block.type === "text" && block.text.trim()) spoken.push(block.text.trim());
      if (response.stop_reason !== "tool_use") break;

      // Run every tool call from this response and return all results in one message.
      const results = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const out = runTool(company, call, block.name, block.input);
        actions.push({ tool: block.name, input: block.input, result: out.content, ok: !out.isError });
        if (out.ended) ended = out.ended;
        results.push({ type: "tool_result", tool_use_id: block.id, content: out.content, ...(out.isError && { is_error: true }) });
      }
      call.messages.push({ role: "user", content: results });
    }
  } catch (err) {
    const msg = explain(err);
    if (msg) throw Object.assign(new Error(msg), { status: 502 });
    throw err;
  }

  return { reply: spoken.join(" "), actions, ended };
}
