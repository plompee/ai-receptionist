// HTTP server: JSON API for companies, calls and activity, plus the static dashboard. No framework needed.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as store from "./store.js";
import { handleCallerTurn } from "./receptionist.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "..", "public");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1"; // local only by default: the API spends your Anthropic credits
const MAX_BODY = 64 * 1024, MAX_SAID = 1000, IDLE_MS = 30 * 60 * 1000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };

const live = new Map(); // callId -> { id, companyId, messages, busy, lastSeen }

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Request too large");
    chunks.push(chunk);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; }
  catch { throw new HttpError(400, "Body must be valid JSON"); }
}

const needCompany = (id) => store.getCompany(id) || (() => { throw new HttpError(404, "Company not found"); })();
function needCall(id) {
  const call = live.get(id);
  if (!call) throw new HttpError(404, "This call has ended or expired");
  call.lastSeen = Date.now();
  return call;
}
function addTranscript(call, who, text) {
  const rec = store.getCallRecord(call.id);
  store.updateRecord("calls", call.id, { transcript: [...(rec?.transcript ?? []), { who, text, at: new Date().toISOString() }] });
}
function finish(call, ended) {
  store.updateRecord("calls", call.id, { endedAt: new Date().toISOString(), outcome: ended.outcome, summary: ended.summary });
  live.delete(call.id);
}

const routes = [
  ["GET", /^\/api\/status$/, () => ({ apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) })],
  ["GET", /^\/api\/companies$/, () => store.listCompanies()],
  ["POST", /^\/api\/companies$/, async (req) => store.createCompany(await readJson(req))],
  ["PUT", /^\/api\/companies\/([\w-]+)$/, async (req, [id]) => { needCompany(id); return store.updateCompany(id, await readJson(req)); }],
  ["DELETE", /^\/api\/companies\/([\w-]+)$/, (req, [id]) => ({ deleted: store.deleteCompany(id) })],
  ["GET", /^\/api\/companies\/([\w-]+)\/activity$/, (req, [id]) => {
    needCompany(id);
    const newest = (rows) => [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Object.fromEntries(["bookings", "messages", "transfers", "calls"].map((k) => [k, newest(store.recordsFor(k, id))]));
  }],
  ["POST", /^\/api\/calls$/, async (req) => {
    const company = needCompany((await readJson(req)).companyId);
    const rec = store.addRecord("calls", { companyId: company.id, startedAt: new Date().toISOString(), outcome: null, summary: null, transcript: [{ who: "receptionist", text: company.greeting, at: new Date().toISOString() }] });
    live.set(rec.id, { id: rec.id, companyId: company.id, messages: [], busy: false, lastSeen: Date.now() });
    return { callId: rec.id, greeting: company.greeting };
  }],
  ["POST", /^\/api\/calls\/([\w-]+)\/turn$/, async (req, [id]) => {
    const call = needCall(id), { text } = await readJson(req);
    if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "Say something first");
    if (text.length > MAX_SAID) throw new HttpError(400, `Keep each turn under ${MAX_SAID} characters`);
    if (call.busy) throw new HttpError(409, "The receptionist is still answering");
    const company = needCompany(call.companyId);
    call.busy = true;
    try {
      addTranscript(call, "caller", text.trim());
      const out = await handleCallerTurn(company, call, text.trim());
      if (out.reply) addTranscript(call, "receptionist", out.reply);
      if (out.ended) finish(call, out.ended);
      return out;
    } finally { call.busy = false; }
  }],
  ["POST", /^\/api\/calls\/([\w-]+)\/hangup$/, (req, [id]) => {
    const call = live.get(id);
    if (call) finish(call, { outcome: "caller_hung_up", summary: "The caller hung up." });
    return { ok: true };
  }],
];

function serveStatic(req, res) {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.normalize(path.join(PUBLIC, url === "/" ? "index.html" : url));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found");
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://x").pathname;
  if (!pathname.startsWith("/api/")) return serveStatic(req, res);
  const route = routes.find(([m, re]) => m === req.method && re.test(pathname));
  if (!route) return send(res, 404, { error: "Not found" });
  try {
    send(res, 200, await route[2](req, route[1].exec(pathname).slice(1)));
  } catch (err) {
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    send(res, status, { error: status === 500 ? "Something went wrong on the server" : err.message });
  }
});

// Drop calls nobody has touched for 30 minutes.
setInterval(() => { for (const [id, c] of live) if (Date.now() - c.lastSeen > IDLE_MS) finish(c, { outcome: "timed_out", summary: "The call went quiet and timed out." }); }, 60_000).unref();

server.listen(PORT, HOST, () => console.log(`AI Receptionist Studio running at http://localhost:${PORT}`));
