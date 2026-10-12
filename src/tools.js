// The receptionist's actions. Business rules are enforced here in code, not in the prompt,
// so a caller can't talk the model into booking outside opening hours or transferring to an unknown person.
import { DAYS, addRecord, recordsFor } from "./store.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function parseDate(s) {
  if (!DATE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number), date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? date : null; // rejects e.g. 2026-02-31
}

/** Free appointment start times on a date, given opening hours, existing bookings and the current time. */
export function freeSlots(company, dateStr, bookings, now = new Date()) {
  const date = parseDate(dateStr);
  if (!date || dateStr < isoDate(now)) return [];
  const hours = company.hours[DAYS[(date.getDay() + 6) % 7]];
  if (!hours) return [];
  const taken = new Set(bookings.filter((b) => b.date === dateStr).map((b) => b.time));
  const step = company.appointmentMinutes, nowMin = dateStr === isoDate(now) ? now.getHours() * 60 + now.getMinutes() : -1;
  const slots = [];
  for (let m = toMin(hours[0]); m + step <= toMin(hours[1]); m += step) {
    if (m > nowMin && !taken.has(toTime(m))) slots.push(toTime(m));
  }
  return slots;
}

const text = (description) => ({ type: "string", description });
const strictTool = (name, description, properties) => ({
  name, description, strict: true,
  input_schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});

/** Tool definitions for one company - only the tasks it has switched on. Order is fixed so the prompt cache stays valid. */
export function toolsFor(company) {
  const tools = [];
  if (company.tasks.bookings) {
    tools.push(strictTool("check_availability", "List free appointment start times on a date. Always check before offering or booking a time.", {
      date: text("Date as YYYY-MM-DD"),
    }));
    tools.push(strictTool("book_appointment", "Book an appointment once the caller has agreed a free time and given their name and phone number.", {
      caller_name: text("Caller's full name"),
      phone: text("Caller's phone number"),
      date: text("Date as YYYY-MM-DD"),
      time: text("Start time as HH:MM (24-hour), one of the free times from check_availability"),
      reason: text("What the appointment is for, in a few words"),
    }));
  }
  if (company.tasks.messages) {
    tools.push(strictTool("take_message", "Record a message for the team when the caller wants a callback or the request can't be handled on the call.", {
      caller_name: text("Caller's name"),
      phone: text("Number to call back"),
      for_whom: text("Who the message is for, or 'team' if unspecified"),
      message: text("The message, including any times the caller is available"),
      urgency: { type: "string", enum: ["low", "normal", "urgent"], description: "How urgent the caller says it is" },
    }));
  }
  if (company.tasks.transfers && company.departments.length) {
    tools.push(strictTool("transfer_call", "Transfer the caller to a department. Only when the caller needs a person and it is one of the listed departments.", {
      department: { type: "string", enum: company.departments.map((d) => d.name), description: "Department to transfer to" },
      caller_name: text("Caller's name, or 'unknown'"),
      reason: text("Why the caller needs this department"),
    }));
  }
  const outcomes = ["resolved", "booked", "message_taken", "transferred", "other"];
  if (company.tasks.spamFilter) outcomes.push("spam");
  tools.push(strictTool("end_call", "End the call after saying goodbye, or immediately for spam/scam calls. Always call this to finish a call.", {
    outcome: { type: "string", enum: outcomes, description: "How the call ended" },
    summary: text("One or two sentences for the team: who called, what they wanted, what was done"),
  }));
  return tools;
}

const PHONE = /^[+\d][\d\s()-]{5,24}$/;
const fail = (msg) => ({ content: msg, isError: true });

/** Runs one tool call for a live call. Returns { content, isError?, ended? }. */
export function runTool(company, call, name, input, now = new Date()) {
  const has = (k, max = 200) => typeof input?.[k] === "string" && input[k].trim() && input[k].length <= max;
  switch (name) {
    case "check_availability": {
      if (!parseDate(input.date)) return fail("Invalid date. Use YYYY-MM-DD.");
      const slots = freeSlots(company, input.date, recordsFor("bookings", company.id), now);
      return { content: slots.length ? `Free times on ${input.date}: ${slots.join(", ")}` : `No free times on ${input.date} (closed, fully booked or in the past).` };
    }
    case "book_appointment": {
      if (!has("caller_name", 80) || !has("reason")) return fail("Name and reason are required.");
      if (!PHONE.test(input.phone ?? "")) return fail("That phone number doesn't look valid - ask the caller to repeat it.");
      if (!TIME.test(input.time ?? "")) return fail("Invalid time. Use HH:MM.");
      if (!freeSlots(company, input.date, recordsFor("bookings", company.id), now).includes(input.time)) {
        return fail(`${input.time} on ${input.date} is not available. Check availability and offer a free time.`);
      }
      const b = addRecord("bookings", { companyId: company.id, callId: call.id, callerName: input.caller_name.trim(), phone: input.phone.trim(), date: input.date, time: input.time, reason: input.reason.trim() });
      return { content: `Booked: ${b.callerName}, ${b.date} at ${b.time}. Reference ${b.id.slice(0, 6).toUpperCase()}.` };
    }
    case "take_message": {
      if (!has("caller_name", 80) || !has("message", 1000) || !has("for_whom", 80)) return fail("Name, recipient and message are required.");
      if (!PHONE.test(input.phone ?? "")) return fail("That phone number doesn't look valid - ask the caller to repeat it.");
      addRecord("messages", { companyId: company.id, callId: call.id, callerName: input.caller_name.trim(), phone: input.phone.trim(), forWhom: input.for_whom.trim(), message: input.message.trim(), urgency: input.urgency });
      return { content: `Message saved for ${input.for_whom}. Tell the caller the team will call them back.` };
    }
    case "transfer_call": {
      const dept = company.departments.find((d) => d.name === input.department);
      if (!dept) return fail("Unknown department.");
      addRecord("transfers", { companyId: company.id, callId: call.id, department: dept.name, contact: dept.contact, callerName: String(input.caller_name ?? "").slice(0, 80), reason: String(input.reason ?? "").slice(0, 300) });
      return { content: `Transferring to ${dept.name} (${dept.contact}). Tell the caller you're putting them through now, then end the call.` };
    }
    case "end_call":
      return { content: "Call ended.", ended: { outcome: input.outcome, summary: String(input.summary ?? "").slice(0, 500) } };
    default:
      return fail(`Unknown tool ${name}`);
  }
}
