import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the store at a throwaway folder before it loads (imports are dynamic for that reason).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "receptionist-test-"));
let store, tools, receptionist;
before(async () => {
  store = await import("../src/store.js");
  tools = await import("../src/tools.js");
  receptionist = await import("../src/receptionist.js");
  store._resetForTests();
});

const agency = () => store.getCompany("hartley-grove");
const MONDAY = "2030-01-07", MONDAY_10_10 = new Date(2030, 0, 7, 10, 10);
const call = { id: "call-1" };

/** The next date (as YYYY-MM-DD) that falls on the given weekday, at least 2 days ahead. */
function nextWeekday(day) {
  const d = new Date(); d.setDate(d.getDate() + 2);
  while (d.getDay() !== day) d.setDate(d.getDate() + 1);
  return tools.isoDate(d);
}

test("free slots follow opening hours, appointment length and the current time", () => {
  const slots = tools.freeSlots(agency(), MONDAY, [], MONDAY_10_10);
  assert.equal(slots[0], "10:30"); // 09:00 and 09:45 are already in the past
  assert.equal(slots.at(-1), "16:30"); // 16:30 + 45 min = 17:15, the last slot that ends before 17:30
  assert.deepEqual(tools.freeSlots(agency(), "2030-01-13", [], MONDAY_10_10), []); // Sunday: closed
  assert.deepEqual(tools.freeSlots(agency(), "2029-12-31", [], MONDAY_10_10), []); // in the past
  assert.deepEqual(tools.freeSlots(agency(), "2030-02-31", [], MONDAY_10_10), []); // not a real date
  assert.ok(!tools.freeSlots(agency(), MONDAY, [{ date: MONDAY, time: "11:15" }], MONDAY_10_10).includes("11:15"));
});

test("booking rejects closed days, taken slots and bad phone numbers, and accepts a valid slot", () => {
  const book = (over) => tools.runTool(agency(), call, "book_appointment", { caller_name: "Priya Shah", phone: "07700 900412", date: MONDAY, time: "11:15", reason: "Valuation", ...over }, MONDAY_10_10);
  assert.equal(book({ date: "2030-01-13" }).isError, true); // Sunday
  assert.equal(book({ time: "11:00" }).isError, true); // not on the 45-minute grid
  assert.equal(book({ phone: "call me" }).isError, true);
  const ok = book({});
  assert.equal(ok.isError, undefined);
  assert.match(ok.content, /Booked: Priya Shah, 2030-01-07 at 11:15/);
  assert.equal(book({ caller_name: "Someone Else" }).isError, true); // now taken - no double booking
});

test("transfers only go to configured departments; end_call reports the outcome", () => {
  assert.equal(tools.runTool(agency(), call, "transfer_call", { department: "CEO", caller_name: "x", reason: "y" }).isError, true);
  assert.match(tools.runTool(agency(), call, "transfer_call", { department: "Lettings", caller_name: "Tom", reason: "rent" }).content, /Priya Grove/);
  assert.deepEqual(tools.runTool(agency(), call, "end_call", { outcome: "spam", summary: "Robocall" }).ended, { outcome: "spam", summary: "Robocall" });
});

test("tools follow the business's switched-on tasks and are strict", () => {
  const names = (c) => tools.toolsFor(c).map((t) => t.name);
  assert.deepEqual(names(agency()), ["check_availability", "book_appointment", "take_message", "transfer_call", "end_call"]);
  const dental = store.getCompany("brightsmile-dental");
  assert.ok(!names(dental).includes("transfer_call")); // transfers are off for the clinic
  for (const t of tools.toolsFor(agency())) {
    assert.equal(t.strict, true);
    assert.equal(t.input_schema.additionalProperties, false);
    assert.deepEqual(t.input_schema.required, Object.keys(t.input_schema.properties));
  }
});

test("company settings are validated", () => {
  const good = { ...agency() };
  assert.equal(store.validateCompany(good).name, "Hartley & Grove");
  assert.throws(() => store.validateCompany({ ...good, name: " " }), /Name is required/);
  assert.throws(() => store.validateCompany({ ...good, appointmentMinutes: 7 }), /Appointment length/);
  assert.throws(() => store.validateCompany({ ...good, hours: { ...good.hours, mon: ["18:00", "09:00"] } }), /opening before closing/);
  assert.throws(() => store.validateCompany({ ...good, faqs: "x".repeat(5000) }), /too long/);
  assert.equal(store.validateCompany({ ...good, greeting: "" }).greeting, "Hello, you've reached Hartley & Grove. How can I help?");
});

test("the system prompt describes the business and only its enabled abilities", () => {
  const p = receptionist.systemPrompt(agency());
  assert.match(p, /phone receptionist for Hartley & Grove/);
  assert.match(p, /Sunday: closed/);
  assert.match(p, /Lettings \(Priya Grove\)/);
  assert.doesNotMatch(receptionist.systemPrompt(store.getCompany("brightsmile-dental")), /Transfer to a person/);
  assert.doesNotMatch(p, /\d{4}-\d{2}-\d{2}/); // no dates: the prompt must be identical across calls so it caches
});

test("a caller turn runs the tool loop: availability → booking → spoken reply", async () => {
  const date = nextWeekday(2); // a Tuesday
  const requests = [];
  const scripted = [
    { stop_reason: "tool_use", content: [{ type: "thinking", thinking: "", signature: "s1" }, { type: "tool_use", id: "t1", name: "check_availability", input: { date } }] },
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "book_appointment", input: { caller_name: "Tom Reed", phone: "+44 7700 900123", date, time: "09:45", reason: "Viewing" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "You're booked in for Tuesday at quarter to ten, Tom." }] },
  ];
  receptionist._setClientForTests({ beta: { messages: { create: async (params) => { requests.push(structuredClone(params)); return scripted.shift(); } } } });

  const live = { id: "call-2", messages: [] };
  const out = await receptionist.handleCallerTurn(agency(), live, "Book me a viewing on Tuesday at 9:45, I'm Tom Reed, 07700 900123");

  assert.equal(out.reply, "You're booked in for Tuesday at quarter to ten, Tom.");
  assert.deepEqual(out.actions.map((a) => [a.tool, a.ok]), [["check_availability", true], ["book_appointment", true]]);
  assert.equal(out.ended, null);
  assert.ok(store.recordsFor("bookings", "hartley-grove").some((b) => b.callerName === "Tom Reed" && b.date === date && b.time === "09:45"));

  // Request shape: right model, low effort, fallbacks on, cached system prompt, date as a mid-conversation system message.
  const first = requests[0];
  assert.equal(first.model, "claude-opus-5-5");
  assert.equal(first.output_config.effort, "low");
  assert.equal(first.fallbacks, "default");
  assert.deepEqual(first.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(first.system[0].cache_control.type, "ephemeral");
  assert.deepEqual(first.messages.map((m) => m.role), ["user", "system"]);
  // History is append-only: each request extends the previous one, thinking blocks kept unchanged.
  assert.deepEqual(requests[1].messages.slice(0, first.messages.length), first.messages);
  assert.deepEqual(requests[1].messages.map((m) => m.role), ["user", "system", "assistant", "user"]);
  assert.equal(requests[1].messages[2].content[0].type, "thinking");
  assert.equal(requests[1].messages[3].content[0].type, "tool_result");
});

test("spam ends the call; a refusal gives a safe spoken fallback", async () => {
  receptionist._setClientForTests({ beta: { messages: { create: async () => ({ stop_reason: "tool_use", content: [
    { type: "text", text: "No thank you, goodbye." },
    { type: "tool_use", id: "t9", name: "end_call", input: { outcome: "spam", summary: "Prize scam robocall." } },
  ] }) } } });
  const spam = await receptionist.handleCallerTurn(agency(), { id: "call-3", messages: [] }, "You've won a free cruise, press 1!");
  assert.equal(spam.reply, "No thank you, goodbye.");
  assert.deepEqual(spam.ended, { outcome: "spam", summary: "Prize scam robocall." });

  receptionist._setClientForTests({ beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } });
  const refused = await receptionist.handleCallerTurn(agency(), { id: "call-4", messages: [] }, "…");
  assert.match(refused.reply, /can't help with that on this line, but I can take a message/);
});
