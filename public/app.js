const $ = (s) => document.querySelector(s);
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const ACTION_LABEL = { check_availability: "Checked diary", book_appointment: "Booked", take_message: "Message taken", transfer_call: "Transferred", end_call: "Call ended" };

let companies = [], current = null, callId = null;

// Builds DOM nodes; text always goes in via textContent, never innerHTML.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === "class" ? (el.className = v) : el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : String(k));
  return el;
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("show"), 5000);
}

/* ---------- Tabs & company picker ---------- */
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(name) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
  for (const t of ["call", "setup", "activity"]) $(`#tab-${t}`).classList.toggle("hidden", t !== name);
  if (name === "activity") loadActivity();
}

async function loadCompanies(selectId) {
  companies = await api("GET", "/api/companies");
  const sel = $("#company");
  sel.replaceChildren(...companies.map((c) => h("option", { value: c.id }, c.name)));
  if (!companies.length) { current = null; fillSetup(blankCompany()); showTab("setup"); return; }
  sel.value = selectId && companies.some((c) => c.id === selectId) ? selectId : companies[0].id;
  selectCompany(sel.value);
}
$("#company").addEventListener("change", (e) => selectCompany(e.target.value));
function selectCompany(id) {
  if (callId) hangUp();
  current = companies.find((c) => c.id === id);
  $("#call-company").textContent = current.name;
  fillSetup(current);
  renderTips();
  $("#transcript").replaceChildren();
  if (!$("#tab-activity").classList.contains("hidden")) loadActivity();
}
$("#new-company").addEventListener("click", () => { current = null; fillSetup(blankCompany()); showTab("setup"); });

function renderTips() {
  const t = current.tasks, tips = [];
  if (t.bookings) tips.push("I'd like to book an appointment for tomorrow morning.");
  if (t.messages) tips.push("Can someone call me back about my account?");
  if (t.transfers && current.departments.length) tips.push(`Can I speak to someone in ${current.departments[0].name}?`);
  if (t.spamFilter) tips.push("Congratulations! You've won a free cruise, press 1 to claim.");
  tips.push("What are your opening hours on Saturday?");
  $("#tips").replaceChildren(...tips.map((s) => h("li", {}, h("button", { type: "button", class: "tip" }, s))));
  $("#tips").querySelectorAll(".tip").forEach((b) => b.addEventListener("click", () => {
    if (!callId) return toast("Start the call first.");
    $("#say").value = b.textContent; $("#talk").requestSubmit();
  }));
}

/* ---------- Call ---------- */
function bubble(who, text, actions = []) {
  const li = h("li", { class: who }, h("span", { class: "who" }, who === "caller" ? "Caller" : "Receptionist"), h("p", {}, text));
  for (const a of actions) {
    if (a.tool === "check_availability") continue;
    li.append(h("span", { class: `chip ${a.ok ? "ok" : "err"}` }, `${a.ok ? "✓" : "⚠"} ${ACTION_LABEL[a.tool] || a.tool}: ${a.result}`));
  }
  $("#transcript").append(li);
  li.scrollIntoView({ block: "end", behavior: "smooth" });
}
function setState(text) { $("#call-state").textContent = text; }
function speak(text) {
  if (!$("#speak").checked || !("speechSynthesis" in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = speechSynthesis.getVoices().find((v) => v.lang === "en-GB") || null;
  u.lang = "en-GB";
  speechSynthesis.speak(u);
}

$("#start").addEventListener("click", async () => {
  if (!current) return toast("Save a business first.");
  try {
    const { callId: id, greeting } = await api("POST", "/api/calls", { companyId: current.id });
    callId = id;
    $("#transcript").replaceChildren();
    bubble("receptionist", greeting);
    speak(greeting);
    $("#idle-controls").classList.add("hidden");
    $("#talk").classList.remove("hidden");
    setState("On call");
    $("#say").focus();
  } catch (e) { toast(e.message); }
});

$("#talk").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#say").value.trim();
  if (!text || !callId) return;
  $("#say").value = "";
  bubble("caller", text);
  setState("Receptionist is answering…");
  $("#talk").classList.add("busy");
  try {
    const out = await api("POST", `/api/calls/${callId}/turn`, { text });
    bubble("receptionist", out.reply || "…", out.actions);
    speak(out.reply);
    if (out.ended) endCallUi(`Call ended · ${out.ended.outcome.replaceAll("_", " ")}`);
    else setState("On call");
  } catch (err) {
    toast(err.message);
    setState("On call");
  } finally { $("#talk").classList.remove("busy"); }
});

function endCallUi(state) {
  callId = null;
  $("#talk").classList.add("hidden");
  $("#idle-controls").classList.remove("hidden");
  setState(state);
}
function hangUp() {
  if (callId) api("POST", `/api/calls/${callId}/hangup`).catch(() => {});
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  endCallUi("You hung up");
}
$("#hangup").addEventListener("click", hangUp);

// Speech recognition (Chrome / Edge). Falls back to typing where unsupported.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Recognition) $("#mic").hidden = true;
$("#mic").addEventListener("click", () => {
  const rec = new Recognition();
  rec.lang = "en-GB"; rec.interimResults = true;
  speechSynthesis?.cancel();
  $("#mic").classList.add("listening"); setState("Listening…");
  rec.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    $("#say").value = r[0].transcript;
    if (r.isFinal) $("#talk").requestSubmit();
  };
  rec.onerror = (e) => { if (e.error !== "no-speech") toast(`Microphone: ${e.error}`); };
  rec.onend = () => { $("#mic").classList.remove("listening"); if (callId && $("#call-state").textContent === "Listening…") setState("On call"); };
  rec.start();
});

/* ---------- Setup ---------- */
function blankCompany() {
  const hours = Object.fromEntries(DAYS.map((d, i) => [d, i < 5 ? ["09:00", "17:00"] : null]));
  return { name: "", industry: "", greeting: "", tone: "", services: "", faqs: "", appointmentMinutes: 30, hours, tasks: { bookings: true, messages: true, transfers: false, spamFilter: true }, departments: [] };
}
function deptRow(d = { name: "", contact: "" }) {
  const row = h("div", { class: "dept" },
    h("input", { placeholder: "Department (e.g. Sales)", maxlength: "40", "data-k": "name" }),
    h("input", { placeholder: "Who answers (e.g. Daniel)", maxlength: "80", "data-k": "contact" }),
    h("button", { type: "button", class: "ghost", "aria-label": "Remove" }, "✕"));
  row.querySelector('[data-k="name"]').value = d.name;
  row.querySelector('[data-k="contact"]').value = d.contact;
  row.querySelector("button").addEventListener("click", () => row.remove());
  return row;
}
function fillSetup(c) {
  const f = $("#setup");
  for (const k of ["name", "industry", "greeting", "tone", "services", "faqs", "appointmentMinutes"]) f.elements[k].value = c[k] ?? "";
  for (const t of ["bookings", "messages", "transfers", "spamFilter"]) f.elements[`task-${t}`].checked = Boolean(c.tasks?.[t]);
  $("#hours").replaceChildren(...DAYS.map((d) => {
    const open = Boolean(c.hours[d]);
    const row = h("div", { class: "day" },
      h("label", { class: "check" }, h("input", { type: "checkbox", "data-day": d }), DAY_LABEL[d]),
      h("input", { type: "time", "data-open": d, value: c.hours[d]?.[0] ?? "09:00" }),
      h("span", {}, "to"),
      h("input", { type: "time", "data-close": d, value: c.hours[d]?.[1] ?? "17:00" }));
    row.querySelector("[data-day]").checked = open;
    row.classList.toggle("closed", !open);
    row.querySelector("[data-day]").addEventListener("change", (e) => row.classList.toggle("closed", !e.target.checked));
    return row;
  }));
  $("#departments").replaceChildren(...(c.departments || []).map(deptRow));
  $("#delete").hidden = !current;
  $("#saved").textContent = "";
}
$("#add-dept").addEventListener("click", () => $("#departments").append(deptRow()));

$("#setup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, body = { hours: {}, tasks: {}, departments: [] };
  for (const k of ["name", "industry", "greeting", "tone", "services", "faqs"]) body[k] = f.elements[k].value;
  body.appointmentMinutes = Number(f.elements.appointmentMinutes.value);
  for (const t of ["bookings", "messages", "transfers", "spamFilter"]) body.tasks[t] = f.elements[`task-${t}`].checked;
  for (const d of DAYS) body.hours[d] = f.querySelector(`[data-day="${d}"]`).checked ? [f.querySelector(`[data-open="${d}"]`).value, f.querySelector(`[data-close="${d}"]`).value] : null;
  body.departments = [...$("#departments").children].map((r) => ({ name: r.querySelector('[data-k="name"]').value, contact: r.querySelector('[data-k="contact"]').value }));
  try {
    const saved = current ? await api("PUT", `/api/companies/${current.id}`, body) : await api("POST", "/api/companies", body);
    await loadCompanies(saved.id);
    $("#saved").textContent = "Saved ✓";
  } catch (err) { toast(err.message); }
});

$("#delete").addEventListener("click", async () => {
  if (!current) return;
  const btn = $("#delete");
  if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = "Click again to delete everything for this business"; setTimeout(() => { btn.dataset.confirm = ""; btn.textContent = "Delete business"; }, 4000); return; }
  await api("DELETE", `/api/companies/${current.id}`).catch((e) => toast(e.message));
  btn.dataset.confirm = ""; btn.textContent = "Delete business";
  await loadCompanies();
});

/* ---------- Activity ---------- */
const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const empty = (msg) => h("p", { class: "empty" }, msg);
async function loadActivity() {
  if (!current) return;
  const a = await api("GET", `/api/companies/${current.id}/activity`).catch((e) => (toast(e.message), null));
  if (!a) return;
  $("#act-bookings").replaceChildren(...(a.bookings.length ? a.bookings.map((b) => h("div", { class: "row" }, h("b", {}, `${b.date} ${b.time}`), ` ${b.callerName} · ${b.phone}`, h("small", {}, b.reason))) : [empty("No bookings yet.")]));
  $("#act-messages").replaceChildren(...(a.messages.length ? a.messages.map((m) => h("div", { class: `row ${m.urgency}` }, h("b", {}, `For ${m.forWhom}`), ` from ${m.callerName} · ${m.phone}`, h("small", {}, `${m.urgency} · ${m.message}`))) : [empty("No messages yet.")]));
  $("#act-transfers").replaceChildren(...(a.transfers.length ? a.transfers.map((t) => h("div", { class: "row" }, h("b", {}, t.department), ` (${t.contact}) · ${t.callerName}`, h("small", {}, t.reason))) : [empty("No transfers yet.")]));
  $("#act-calls").replaceChildren(...(a.calls.length ? a.calls.map((c) => h("details", { class: "call" },
    h("summary", {}, h("span", { class: `badge ${c.outcome || "live"}` }, (c.outcome || "in progress").replaceAll("_", " ")), ` ${when(c.startedAt)} — ${c.summary || "No summary yet."}`),
    h("ol", {}, ...(c.transcript || []).map((t) => h("li", { class: t.who }, h("b", {}, t.who === "caller" ? "Caller: " : "Receptionist: "), t.text))))) : [empty("No calls yet.")]));
}

/* ---------- Start ---------- */
api("GET", "/api/status").then((s) => {
  const el = $("#key-status");
  el.textContent = s.apiKeyConfigured ? "● API key set" : "● No API key — calls won't work yet";
  el.classList.add(s.apiKeyConfigured ? "ok" : "warn");
}).catch(() => {});
loadCompanies().catch((e) => toast(e.message));
