// Setup tab: the form that configures one business.
import { $, $$, h, api, toast, state, DAYS, DAY_LABEL, LANG_CODES } from "./ui.js";

const QUALITY_HINT = { fast: "quickest replies", balanced: "a little slower, more careful", best: "slowest, most thoughtful" };
let onSaved = () => {};

export function blankCompany() {
  const hours = Object.fromEntries(DAYS.map((d, i) => [d, i < 5 ? ["09:00", "17:00"] : null]));
  return {
    name: "", industry: "", persona: "", languages: ["English"], greeting: "", recordingNotice: false, tone: "",
    answerStyle: "balanced", quality: "fast", voice: { name: "", rate: 1 }, services: [], facts: "", emergency: "", extraInstructions: "",
    appointmentMinutes: 30, minNoticeHours: 0, bookingWindowDays: 60, afterHours: "normal", collect: { email: false, address: false },
    hours, tasks: { bookings: true, cancellations: true, messages: true, transfers: false, spamFilter: true }, departments: [],
  };
}

/* ---------- Rows ---------- */
function serviceRow(s = { name: "", price: "", minutes: "" }) {
  const row = h("div", { class: "row3" },
    h("input", { placeholder: "Service (e.g. Check-up)", maxlength: "60", "data-k": "name", value: s.name }),
    h("input", { placeholder: "Price (e.g. £45)", maxlength: "40", "data-k": "price", value: s.price }),
    h("input", { type: "number", min: "5", max: "480", placeholder: "Minutes", "data-k": "minutes", value: s.minutes }),
    h("button", { type: "button", class: "btn ghost icon", "aria-label": "Remove service", onclick: () => row.remove() }, "✕"));
  return row;
}
function deptRow(d = { name: "", contact: "" }) {
  const row = h("div", { class: "row2" },
    h("input", { placeholder: "Department (e.g. Sales)", maxlength: "40", "data-k": "name", value: d.name }),
    h("input", { placeholder: "Who answers (e.g. Daniel)", maxlength: "80", "data-k": "contact", value: d.contact }),
    h("button", { type: "button", class: "btn ghost icon", "aria-label": "Remove department", onclick: () => row.remove() }, "✕"));
  return row;
}
function hourRow(d, hours) {
  const row = h("div", { class: `day${hours ? "" : " closed"}` },
    h("label", { class: "toggle" }, h("input", { type: "checkbox", "data-day": d, checked: Boolean(hours), onchange: (e) => row.classList.toggle("closed", !e.target.checked) }), h("span"), ` ${DAY_LABEL[d]}`),
    h("input", { type: "time", "data-open": d, value: hours?.[0] ?? "09:00" }),
    h("span", { class: "muted" }, "to"),
    h("input", { type: "time", "data-close": d, value: hours?.[1] ?? "17:00" }));
  return row;
}

/* ---------- Voices ---------- */
function fillVoices(selected) {
  const sel = $("#setup").elements.voice;
  const voices = ("speechSynthesis" in window ? speechSynthesis.getVoices() : []).slice().sort((a, b) => a.lang.localeCompare(b.lang));
  sel.replaceChildren(h("option", { value: "" }, "Automatic (best match for the language)"), ...voices.map((v) => h("option", { value: v.name }, `${v.name} — ${v.lang}`)));
  sel.value = voices.some((v) => v.name === selected) ? selected : "";
}
if ("speechSynthesis" in window) speechSynthesis.addEventListener?.("voiceschanged", () => fillVoices(state.current?.voice?.name ?? $("#setup").elements.voice.value));

/* ---------- Fill & read ---------- */
function setSeg(name, value) { $$(`[data-seg="${name}"] button`).forEach((b) => b.classList.toggle("on", b.dataset.v === value)); }
const segValue = (name) => $(`[data-seg="${name}"] .on`)?.dataset.v;

export function fillSetup(c, { isNew = false } = {}) {
  const f = $("#setup");
  for (const k of ["name", "industry", "persona", "greeting", "tone", "facts", "emergency", "extraInstructions", "appointmentMinutes", "minNoticeHours", "bookingWindowDays", "afterHours"]) f.elements[k].value = c[k] ?? "";
  // Selects only hold preset values; keep an unusual saved value selectable.
  for (const k of ["minNoticeHours", "bookingWindowDays"]) {
    if (f.elements[k].value !== String(c[k])) f.elements[k].append(h("option", { value: c[k], selected: true }, String(c[k])));
  }
  f.elements.recordingNotice.checked = c.recordingNotice;
  for (const [t, on] of Object.entries(c.tasks)) f.elements[`task-${t}`].checked = on;
  f.elements["collect-email"].checked = c.collect.email;
  f.elements["collect-address"].checked = c.collect.address;
  setSeg("answerStyle", c.answerStyle); setSeg("quality", c.quality);
  $("#quality-hint").textContent = `· ${QUALITY_HINT[c.quality]}`;
  f.elements.rate.value = c.voice.rate; $("#rate-out").textContent = `${Number(c.voice.rate).toFixed(2)}×`;
  fillVoices(c.voice.name);
  $("#languages").replaceChildren(...state.meta.languages.map((l) => h("button", { type: "button", class: `chip${c.languages.includes(l) ? " on" : ""}`, "data-lang": l, onclick: (e) => e.currentTarget.classList.toggle("on") }, l)));
  $("#services").replaceChildren(...c.services.map(serviceRow));
  $("#hours").replaceChildren(...DAYS.map((d) => hourRow(d, c.hours[d])));
  $("#departments").replaceChildren(...c.departments.map(deptRow));
  $("#templates-card").classList.toggle("collapsed", !isNew);
  $("#delete").hidden = isNew;
  $("#saved").textContent = "";
}

function readSetup() {
  const f = $("#setup"), v = (k) => f.elements[k].value;
  const rows = (sel, keys) => $$(`${sel} > div`).map((r) => Object.fromEntries(keys.map((k) => [k, $(`[data-k="${k}"]`, r).value])));
  return {
    name: v("name"), industry: v("industry"), persona: v("persona"), greeting: v("greeting"), tone: v("tone"),
    recordingNotice: f.elements.recordingNotice.checked,
    languages: $$("#languages .chip.on").map((b) => b.dataset.lang),
    answerStyle: segValue("answerStyle"), quality: segValue("quality"),
    voice: { name: v("voice"), rate: Number(v("rate")) },
    services: rows("#services", ["name", "price", "minutes"]),
    facts: v("facts"), emergency: v("emergency"), extraInstructions: v("extraInstructions"),
    appointmentMinutes: Number(v("appointmentMinutes")), minNoticeHours: Number(v("minNoticeHours")), bookingWindowDays: Number(v("bookingWindowDays")), afterHours: v("afterHours"),
    collect: { email: f.elements["collect-email"].checked, address: f.elements["collect-address"].checked },
    hours: Object.fromEntries(DAYS.map((d) => [d, $(`[data-day="${d}"]`).checked ? [$(`[data-open="${d}"]`).value, $(`[data-close="${d}"]`).value] : null])),
    tasks: Object.fromEntries(["bookings", "cancellations", "messages", "transfers", "spamFilter"].map((t) => [t, f.elements[`task-${t}`].checked])),
    departments: rows("#departments", ["name", "contact"]),
  };
}

function applyTemplate(t) {
  const f = $("#setup"), name = f.elements.name.value.trim() || `My ${t.label.toLowerCase()}`;
  const fill = (s) => (s || "").replaceAll("{name}", name).replaceAll("{persona}", t.persona);
  fillSetup({ ...blankCompany(), ...t, name, greeting: fill(t.greeting), collect: t.collect ?? { email: false, address: false } }, { isNew: !state.current });
  toast(`${t.label} template applied — check the details, then save.`, "info");
}

/* ---------- Wiring ---------- */
export function initSetup({ saved }) {
  onSaved = saved;
  $("#templates").replaceChildren(...state.meta.templates.map((t) => h("button", { type: "button", class: "template", onclick: () => applyTemplate(t) }, h("span", {}, t.icon), t.label)));
  $$("[data-seg] button").forEach((b) => b.addEventListener("click", () => {
    setSeg(b.parentElement.dataset.seg, b.dataset.v);
    if (b.parentElement.dataset.seg === "quality") $("#quality-hint").textContent = `· ${QUALITY_HINT[b.dataset.v]}`;
  }));
  $("#setup").elements.rate.addEventListener("input", (e) => { $("#rate-out").textContent = `${Number(e.target.value).toFixed(2)}×`; });
  $("#add-service").addEventListener("click", () => $("#services").append(serviceRow()));
  $("#add-dept").addEventListener("click", () => $("#departments").append(deptRow()));
  $("#preview-voice").addEventListener("click", () => {
    if (!("speechSynthesis" in window)) return toast("This browser can't speak.");
    const f = $("#setup"), u = new SpeechSynthesisUtterance(f.elements.greeting.value || "Hello, how can I help?");
    u.voice = speechSynthesis.getVoices().find((x) => x.name === f.elements.voice.value) || null;
    u.lang = u.voice?.lang || LANG_CODES.English; u.rate = Number(f.elements.rate.value);
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  });
  $("#setup").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const body = readSetup(), cur = state.current;
      const saved = cur ? await api("PUT", `/api/companies/${cur.id}`, body) : await api("POST", "/api/companies", body);
      $("#saved").textContent = "Saved ✓";
      onSaved(saved);
    } catch (err) { toast(err.message); }
  });
  $("#delete").addEventListener("click", async (e) => {
    const btn = e.currentTarget, cur = state.current;
    if (!cur) return;
    if (btn.dataset.confirm !== "1") {
      btn.dataset.confirm = "1"; btn.textContent = "Click again to delete it and all its calls";
      setTimeout(() => { btn.dataset.confirm = ""; btn.textContent = "Delete business"; }, 4000);
      return;
    }
    btn.dataset.confirm = ""; btn.textContent = "Delete business";
    try { await api("DELETE", `/api/companies/${cur.id}`); onSaved(null); } catch (err) { toast(err.message); }
  });
}
