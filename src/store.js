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
  const minutes = Number(input.appointmentMinutes);
  if (![15, 20, 30, 45, 60, 90].includes(minutes)) throw bad("Appointment length must be 15, 20, 30, 45, 60 or 90 minutes");
  const departments = (Array.isArray(input.departments) ? input.departments : []).slice(0, 10).map((d, i) => ({
    name: str(d?.name ?? "", 40, `Department ${i + 1} name`),
    contact: str(d?.contact ?? "", 80, `Department ${i + 1} contact`),
  })).filter((d) => d.name);
  const tasks = {};
  for (const t of ["bookings", "messages", "transfers", "spamFilter"]) tasks[t] = Boolean(input.tasks?.[t]);
  return {
    name,
    industry: str(input.industry ?? "", 60, "Business type"),
    greeting: str(input.greeting ?? "", 200, "Greeting") || `Hello, you've reached ${name}. How can I help?`,
    tone: str(input.tone ?? "", 200, "Tone"),
    services: str(input.services ?? "", 2000, "Services"),
    faqs: str(input.faqs ?? "", 4000, "FAQs"),
    appointmentMinutes: minutes,
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

export const recordsFor = (kind, companyId) => load()[kind].filter((r) => r.companyId === companyId);
export const getCallRecord = (id) => load().calls.find((r) => r.id === id) || null;

/** For tests: point the store at a fresh in-memory copy of the seed data. */
export function _resetForTests() { db = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")); for (const k of ["companies", "bookings", "messages", "transfers", "calls"]) db[k] ??= []; }
