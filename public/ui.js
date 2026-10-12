// Shared helpers for the dashboard modules.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_LABEL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
export const LANG_CODES = { English: "en-GB", Ukrainian: "uk-UA", Russian: "ru-RU", Polish: "pl-PL", Spanish: "es-ES", French: "fr-FR", German: "de-DE", Italian: "it-IT", Portuguese: "pt-PT", Romanian: "ro-RO", Arabic: "ar-SA", Hindi: "hi-IN", Chinese: "zh-CN" };

// Shared app state, read by every module.
export const state = { companies: [], current: null, meta: { templates: [], languages: [] } };

/** Builds a DOM node. Text always goes in as text nodes - never as HTML - so caller/AI text can't inject markup. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

export async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function toast(msg, kind = "error") {
  const t = $("#toast");
  t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("show"), 4500);
}

export const initials = (s) => (s || "?").split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
/** Turns ISO dates inside a sentence into "Tue 13 Oct" for display. */
export const readableDates = (text) => String(text).replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, y, m, d) =>
  new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }));
export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const pretty = (s) => String(s || "").replaceAll("_", " ");
