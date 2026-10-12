// Tiny JSON-file store: one file holds companies and everything the receptionist records.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(here, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SEED_FILE = path.join(here, "seed.json");

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

let db = null;
const bad = (message) => Object.assign(new Error(message), { status: 400 });

function load() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = fs.existsSync(DB_FILE) ? DB_FILE : SEED_FILE;
  db = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of ["companies", "bookings", "messages", "transfers", "calls"]) db[key] ??= [];
  return db;
}

function save() {
  // Write to a temp file then rename, so a crash mid-write never corrupts the database.
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

const str = (v, max, field) => {
  if (typeof v !== "string") throw bad(`${field} must be text`);
  const s = v.trim();
  if (s.length > max) throw bad(`${field} is too long (max ${max} characters)`);
  return s;
};

export const LANGUAGES = ["English", "Ukrainian", "Russian", "Polish", "Spanish", "French", "German", "Italian", "Portuguese", "Romanian", "Arabic", "Hindi", "Chinese"];
export const TASKS = ["bookings", "cancellations", "messages", "transfers", "spamFilter"];
const SLOT_MINUTES = [10, 15, 20, 30, 45, 60, 90];
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const intIn = (v, min, max, field) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} must be a whole number from ${min} to ${max}`);
  return n;
};

/** Validates and normalises company settings coming from the browser. Throws with a readable message. */
export function validateCompany(input) {
  if (!input || typeof input !== "object") throw bad("Invalid company settings");
  const name = str(input.name, 80, "Name");
  if (!name) throw bad("Name is required");
  const hours = {};
  for (const d of DAYS) {
    const h = input.hours?.[d];
    if (h == null) { hours[d] = null; continue; }
    if (!Array.isArray(h) || h.length !== 2 || !TIME.test(h[0]) || !TIME.test(h[1]) || h[0] >= h[1]) {
      throw bad(`Opening hours for ${d} must be two times like 09:00 and 17:30, opening before closing`);
    }
    hours[d] = [h[0], h[1]];
  }
  const slot = Number(input.appointmentMinutes);
  if (!SLOT_MINUTES.includes(slot)) throw bad(`Booking slot length must be one of ${SLOT_MINUTES.join(", ")} minutes`);
  const services = (Array.isArray(input.services) ? input.services : []).slice(0, 30).map((s, i) => ({
    name: str(s?.name ?? "", 60, `Service ${i + 1} name`),
    price: str(s?.price ?? "", 40, `Service ${i + 1} price`),
    minutes: s?.minutes === "" || s?.minutes == null ? slot : intIn(s.minutes, 5, 480, `Service ${i + 1} length`),
  })).filter((s) => s.name);
  if (new Set(services.map((s) => s.name.toLowerCase())).size !== services.length) throw bad("Each service needs a different name");
  const departments = (Array.isArray(input.departments) ? input.departments : []).slice(0, 10).map((d, i) => ({
    name: str(d?.name ?? "", 40, `Department ${i + 1} name`),
    contact: str(d?.contact ?? "", 80, `Department ${i + 1} contact`),
  })).filter((d) => d.name);
  const tasks = Object.fromEntries(TASKS.map((t) => [t, Boolean(input.tasks?.[t])]));
  const languages = (Array.isArray(input.languages) ? input.languages : []).filter((l) => LANGUAGES.includes(l));
  return {
    name,
    industry: str(input.industry ?? "", 60, "Business type"),
    persona: str(input.persona ?? "", 30, "Receptionist name"),
    languages: languages.length ? [...new Set(languages)] : ["English"],
    greeting: str(input.greeting ?? "", 240, "Greeting") || `Hello, you've reached ${name}. How can I help?`,
    recordingNotice: Boolean(input.recordingNotice),
    tone: str(input.tone ?? "", 200, "Tone"),
    answerStyle: pick(input.answerStyle, ["short", "balanced", "detailed"], "balanced"),
    quality: pick(input.quality, ["fast", "balanced", "best"], "fast"),
    voice: { name: str(input.voice?.name ?? "", 100, "Voice"), rate: Math.min(1.4, Math.max(0.7, Number(input.voice?.rate) || 1)) },
    services,
    facts: str(input.facts ?? "", 5000, "Facts & FAQs"),
    emergency: str(input.emergency ?? "", 600, "Emergency instructions"),
    extraInstructions: str(input.extraInstructions ?? "", 1500, "Extra instructions"),
    appointmentMinutes: slot,
    minNoticeHours: intIn(input.minNoticeHours ?? 0, 0, 168, "Minimum notice (hours)"),
    bookingWindowDays: intIn(input.bookingWindowDays ?? 60, 1, 365, "Booking window (days)"),
    afterHours: pick(input.afterHours, ["normal", "messages"], "normal"),
    collect: { email: Boolean(input.collect?.email), address: Boolean(input.collect?.address) },
    hours,
    tasks,
    departments,
  };
}

export const listCompanies = () => load().companies;
export const getCompany = (id) => load().companies.find((c) => c.id === id) || null;

export function createCompany(input) {
  const company = { id: randomUUID(), ...validateCompany(input) };
  load().companies.push(company);
  save();
  return company;
}

export function updateCompany(id, input) {
  const list = load().companies, i = list.findIndex((c) => c.id === id);
  if (i < 0) return null;
  list[i] = { id, ...validateCompany(input) };
  save();
  return list[i];
}

export function deleteCompany(id) {
  const d = load(), before = d.companies.length;
  d.companies = d.companies.filter((c) => c.id !== id);
  for (const key of ["bookings", "messages", "transfers", "calls"]) d[key] = d[key].filter((r) => r.companyId !== id);
  save();
  return d.companies.length < before;
}

/** Adds a record (booking, message, transfer or call) and returns it. */
export function addRecord(kind, record) {
  const row = { id: randomUUID(), createdAt: new Date().toISOString(), ...record };
  load()[kind].push(row);
  save();
  return row;
}

export function updateRecord(kind, id, patch) {
  const row = load()[kind].find((r) => r.id === id);
  if (row) { Object.assign(row, patch); save(); }
  return row;
}

export const getRecord = (kind, id) => load()[kind].find((r) => r.id === id) || null;
export const recordsFor = (kind, companyId) => load()[kind].filter((r) => r.companyId === companyId);
export const getCallRecord = (id) => load().calls.find((r) => r.id === id) || null;

/** For tests: point the store at a fresh in-memory copy of the seed data. */
export function _resetForTests() { db = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")); for (const k of ["companies", "bookings", "messages", "transfers", "calls"]) db[k] ??= []; }
