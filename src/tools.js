// The receptionist's actions. Business rules are enforced here in code, not in the prompt,
// so a caller can't talk the model into booking outside opening hours or transferring to an unknown person.
import { DAYS, addRecord, recordsFor, updateRecord } from "./store.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE = /^[+\d][\d\s()-]{5,24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const digits = (p) => String(p ?? "").replace(/\D/g, "").slice(-9); // last 9 digits: matches 07700… and +44 7700…
export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function parseDate(s) {
  if (!DATE.test(s ?? "")) return null;
  const [y, m, d] = s.split("-").map(Number), date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? date : null; // rejects e.g. 2026-02-31
}

export const serviceMinutes = (company, service) => company.services.find((s) => s.name === service)?.minutes ?? company.appointmentMinutes;
const active = (company) => recordsFor("bookings", company.id).filter((b) => b.status !== "cancelled");

/**
 * Free start times on a date for an appointment of `minutes` length: inside opening hours, on the slot grid,
 * not overlapping other bookings, after the minimum notice and within the booking window.
 */
export function freeSlots(company, dateStr, bookings, now = new Date(), minutes = company.appointmentMinutes) {
  const date = parseDate(dateStr);
  if (!date) return [];
  const last = new Date(now); last.setDate(last.getDate() + company.bookingWindowDays);
  if (dateStr < isoDate(now) || dateStr > isoDate(last)) return [];
  const hours = company.hours[DAYS[(date.getDay() + 6) % 7]];
  if (!hours) return [];
  const earliest = now.getTime() + company.minNoticeHours * 3600_000;
  const taken = bookings.filter((b) => b.date === dateStr && b.status !== "cancelled")
    .map((b) => [toMin(b.time), toMin(b.time) + (b.minutes ?? company.appointmentMinutes)]);
  const slots = [];
  for (let m = toMin(hours[0]); m + minutes <= toMin(hours[1]); m += company.appointmentMinutes) {
    const start = new Date(date); start.setHours(0, m, 0, 0);
    if (start.getTime() < earliest) continue;
    if (taken.some(([s, e]) => m < e && s < m + minutes)) continue;
    slots.push(toTime(m));
  }
  return slots;
}

const text = (description) => ({ type: "string", description });
const strictTool = (name, description, properties) => ({
  name, description, strict: true,
  input_schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});

/** Tool definitions for one company - only the abilities it has switched on. Order is fixed so the prompt cache stays valid. */
export function toolsFor(company) {
  const tools = [], serviceNames = company.services.map((s) => s.name);
  const service = serviceNames.length ? { service: { type: "string", enum: serviceNames, description: "Which service" } } : {};
  if (company.tasks.bookings) {
    tools.push(strictTool("check_availability", "List free start times on a date. Always check before offering or booking a time.", {
      date: text("Date as YYYY-MM-DD"), ...service,
    }));
    tools.push(strictTool("book_appointment", "Book once the caller has chosen a free time and you have their details. Read the details back before booking.", {
      caller_name: text("Caller's full name"),
      phone: text("Caller's phone number"),
      date: text("Date as YYYY-MM-DD"),
      time: text("Start time as HH:MM (24-hour), one of the free times from check_availability"),
      ...service,
      notes: text("Anything the team should know (party size, car registration, symptoms...), or 'none'"),
      ...(company.collect.email && { email: text("Caller's email address") }),
      ...(company.collect.address && { address: text("Caller's address or at least postcode") }),
    }));
  }
  if (company.tasks.cancellations) {
    tools.push(strictTool("find_bookings", "Look up a caller's upcoming bookings by their phone number.", { phone: text("Caller's phone number") }));
    tools.push(strictTool("cancel_booking", "Cancel one of the caller's bookings after they confirm which one. To reschedule, book the new time first, then cancel the old one.", {
      phone: text("Caller's phone number"), date: text("Date of the booking, YYYY-MM-DD"), time: text("Time of the booking, HH:MM"),
    }));
  }
  if (company.tasks.messages) {
    tools.push(strictTool("take_message", "Record a message for the team when the caller wants a callback or you can't fully help.", {
      caller_name: text("Caller's name"),
      phone: text("Number to call back"),
      for_whom: text("Who the message is for, or 'team'"),
      message: text("The message, including when the caller is free to talk"),
      urgency: { type: "string", enum: ["low", "normal", "urgent"], description: "How urgent it is" },
    }));
  }
  if (company.tasks.transfers && company.departments.length) {
    tools.push(strictTool("transfer_call", "Transfer the caller to a department when they need a person. Only listed departments.", {
      department: { type: "string", enum: company.departments.map((d) => d.name), description: "Department" },
      caller_name: text("Caller's name, or 'unknown'"),
      reason: text("Why the caller needs this department"),
    }));
  }
  const outcomes = ["resolved", "booked", "cancelled", "message_taken", "transferred", "other"];
  if (company.tasks.spamFilter) outcomes.push("spam");
  tools.push(strictTool("end_call", "End the call after saying goodbye, or straight away for spam and scam calls. Always call this to finish.", {
    outcome: { type: "string", enum: outcomes, description: "How the call ended" },
    summary: text("One or two sentences for the team: who called, what they wanted, what was done"),
  }));
  return tools;
}

const fail = (msg) => ({ content: msg, isError: true });
const has = (input, k, max = 200) => typeof input?.[k] === "string" && input[k].trim() && input[k].length <= max;

/** Runs one tool call for a live call. Returns { content, isError?, ended? }. */
export function runTool(company, call, name, input, now = new Date()) {
  switch (name) {
    case "check_availability": {
      if (!parseDate(input.date)) return fail("Invalid date. Use YYYY-MM-DD.");
      const minutes = serviceMinutes(company, input.service);
      const slots = freeSlots(company, input.date, active(company), now, minutes);
      if (!slots.length) return { content: `No free times on ${input.date} for a ${minutes}-minute appointment (closed, fully booked, too soon or too far ahead).` };
      return { content: `Free ${minutes}-minute start times on ${input.date}: ${slots.join(", ")}. Offer the caller two or three of these, not the whole list.` };
    }
    case "book_appointment": {
      if (!has(input, "caller_name", 80)) return fail("Caller name is required.");
      if (!PHONE.test(input.phone ?? "")) return fail("That phone number doesn't look valid - ask the caller to repeat it.");
      if (!TIME.test(input.time ?? "")) return fail("Invalid time. Use HH:MM.");
      if (company.collect.email && !EMAIL.test(input.email ?? "")) return fail("That email doesn't look valid - ask the caller to spell it.");
      if (company.collect.address && !has(input, "address", 200)) return fail("An address or postcode is required.");
      const minutes = serviceMinutes(company, input.service);
      if (!freeSlots(company, input.date, active(company), now, minutes).includes(input.time)) {
        return fail(`${input.time} on ${input.date} isn't available for a ${minutes}-minute appointment. Check availability and offer a free time.`);
      }
      const b = addRecord("bookings", {
        companyId: company.id, callId: call.id, status: "booked", callerName: input.caller_name.trim(), phone: input.phone.trim(),
        date: input.date, time: input.time, minutes, service: input.service ?? null, notes: String(input.notes ?? "").slice(0, 500),
        email: input.email ?? null, address: input.address ?? null,
      });
      return { content: `Booked ${b.service ?? "appointment"} for ${b.callerName} on ${b.date} at ${b.time} (${minutes} min). Reference ${b.id.slice(0, 6).toUpperCase()}.` };
    }
    case "find_bookings": {
      const today = isoDate(now), mine = active(company).filter((b) => digits(b.phone) === digits(input.phone) && b.date >= today)
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      return { content: mine.length ? `Upcoming bookings: ${mine.map((b) => `${b.service ?? "appointment"} on ${b.date} at ${b.time}`).join("; ")}.` : "No upcoming bookings for that number." };
    }
    case "cancel_booking": {
      const b = active(company).find((x) => digits(x.phone) === digits(input.phone) && x.date === input.date && x.time === input.time);
      if (!b) return fail("No booking matches that phone number, date and time. Use find_bookings first.");
      updateRecord("bookings", b.id, { status: "cancelled", cancelledAt: new Date().toISOString(), cancelledByCall: call.id });
      return { content: `Cancelled ${b.service ?? "appointment"} on ${b.date} at ${b.time}.` };
    }
    case "take_message": {
      if (!has(input, "caller_name", 80) || !has(input, "message", 1000) || !has(input, "for_whom", 80)) return fail("Name, recipient and message are required.");
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
