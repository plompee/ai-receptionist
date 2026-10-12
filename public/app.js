import { $, $$, h, api, toast, state, initials, readableDates, LANG_CODES } from "./ui.js";
import { initSetup, fillSetup, blankCompany } from "./setup.js";
import { initDiary, renderDiary, renderActivity } from "./views.js";

const ICON = { check_availability: "🔎", book_appointment: "✅", find_bookings: "📋", cancel_booking: "🗑️", take_message: "✉️", transfer_call: "↪️", end_call: "📴" };
const LABEL = { check_availability: "Checked the diary", book_appointment: "Booked", find_bookings: "Looked up bookings", cancel_booking: "Cancelled", take_message: "Took a message", transfer_call: "Transferred", end_call: "Ended the call" };
const ABILITY = { bookings: "Bookings", cancellations: "Changes", messages: "Messages", transfers: "Transfers", spamFilter: "Spam filter" };
let tab = "call", callId = null, timer = null, startedAt = 0;

/* ---------- Sidebar, header, tabs ---------- */
function renderSidebar() {
  $("#biz-list").replaceChildren(...state.companies.map((c) => h("button", {
    type: "button", class: `biz${state.current?.id === c.id ? " active" : ""}`, onclick: () => select(c.id),
  }, h("span", { class: "biz-avatar" }, initials(c.name)), h("span", {}, h("b", {}, c.name), h("small", {}, c.industry || "Business")))));
}
function renderBar() {
  const c = state.current;
  $("#bar-avatar").textContent = c ? initials(c.name) : "＋";
  $("#bar-name").textContent = c ? c.name : "New business";
  $("#bar-sub").textContent = c ? `${c.industry || "Business"} · receptionist ${c.persona || "unnamed"} · ${c.languages.join(", ")}` : "Pick a template or fill in the details, then save.";
  $("#bar-pills").replaceChildren(...(c ? Object.entries(c.tasks).map(([k, on]) => h("span", { class: `pill${on ? " on" : ""}` }, `${on ? "●" : "○"} ${ABILITY[k]}`)) : []));
}
function showTab(name) {
  tab = name;
  $$("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
  $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== `view-${name}`));
  if (name === "diary") renderDiary();
  if (name === "activity") renderActivity();
}
$$("[data-tab]").forEach((b) => b.addEventListener("click", () => {
  if (!state.current && b.dataset.tab !== "setup") return toast("Save the business first.", "info");
  showTab(b.dataset.tab);
}));

function select(id) {
  if (callId) hangUp();
  state.current = state.companies.find((c) => c.id === id) || null;
  renderSidebar(); renderBar();
  if (!state.current) return;
  fillSetup(state.current);
  resetCallScreen();
  if (tab === "diary") renderDiary();
  if (tab === "activity") renderActivity();
}
async function reload(selectId) {
  state.companies = await api("GET", "/api/companies");
  if (!state.companies.length) { newBusiness(); renderSidebar(); return; }
  select(state.companies.some((c) => c.id === selectId) ? selectId : state.companies[0].id);
}
function newBusiness() {
  if (callId) hangUp();
  state.current = null;
  renderSidebar(); renderBar();
  fillSetup(blankCompany(), { isNew: true });
  showTab("setup");
}
$("#new-biz").addEventListener("click", newBusiness);

/* ---------- Call screen ---------- */
function resetCallScreen() {
  const c = state.current;
  $("#persona-name").textContent = c.persona || "Receptionist";
  $("#persona-biz").textContent = c.name;
  $("#persona-initials").textContent = initials(c.persona || c.name);
  $("#call-lang").replaceChildren(...c.languages.map((l) => h("option", { value: l }, l)));
  $("#transcript").replaceChildren(h("li", { class: "empty-call" }, h("span", {}, "📞"), h("p", {}, "Press ", h("b", {}, "Start call"), " and play the caller.", h("br"), "Talk with the mic or type.")));
  $("#timeline").replaceChildren(h("li", { class: "muted" }, "Nothing yet."));
  setCaller({});
  setState("Ready", "idle");
  $("#call-timer").textContent = "00:00";
  renderTips();
}
function renderTips() {
  const c = state.current, tips = [];
  const svc = c.services[0]?.name?.toLowerCase();
  if (c.tasks.bookings) tips.push(`Hi, I'd like to book ${svc ? `a ${svc}` : "an appointment"} next week, please.`);
  if (c.tasks.cancellations) tips.push("I need to cancel my appointment — my number is 07700 900412.");
  if (c.tasks.messages) tips.push("Could someone call me back this afternoon?");
  if (c.tasks.transfers && c.departments.length) tips.push(`Can I speak to someone in ${c.departments[0].name}?`);
  tips.push("How much does it cost, and where are you?");
  if (c.tasks.spamFilter) tips.push("Congratulations! You've won a free cruise, press 1 to claim.");
  if (c.languages.length > 1) tips.push(c.languages.includes("Ukrainian") ? "Добрий день, чи можна записатися на завтра?" : `(Try speaking ${c.languages[1]})`);
  tips.push("Are you a real person?");
  $("#tips").replaceChildren(...tips.map((t) => h("button", { type: "button", class: "tip", onclick: () => {
    if (!callId) return toast("Start the call first.", "info");
    $("#say").value = t; $("#talk").requestSubmit();
  } }, t)));
}
function setState(text, mode) {
  $("#call-state").lastChild.textContent = text;
  $("#phone").dataset.mode = mode;
}
function setCaller(info) {
  const rows = [["Name", info.caller_name], ["Phone", info.phone], ["Email", info.email], ["Address", info.address], ["Service", info.service]].filter(([k, v]) => v || k === "Name" || k === "Phone");
  $("#caller").replaceChildren(...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v || "—")]));
}
let caller = {};
function bubble(who, text) {
  $(".empty-call")?.remove();
  const li = h("li", { class: who }, h("span", { class: "avatar" }, who === "caller" ? "🙂" : initials(state.current.persona || state.current.name)), h("div", { class: "msg" }, h("p", {}, text)));
  $("#transcript").append(li);
  li.scrollIntoView({ block: "end", behavior: "smooth" });
  return li;
}
/** Short, readable version of a tool result for the UI (the model still gets the full text). */
function summarize(a) {
  const free = /^Free (\d+)-minute start times on (\S+): (.*?)\. Offer/.exec(a.result);
  if (free) return `${free[3].split(", ").length} free ${free[1]}-minute slots on ${readableDates(free[2])}`;
  return readableDates(a.result);
}
function addActions(li, actions) {
  if (!actions.length) return;
  if ($("#timeline .muted")) $("#timeline").replaceChildren();
  for (const a of actions) {
    for (const k of ["caller_name", "phone", "email", "address", "service"]) if (a.input?.[k]) caller[k] = a.input[k];
    $("#timeline").append(h("li", { class: a.ok ? "ok" : "warn" }, h("span", {}, ICON[a.tool] || "•"), h("div", {}, h("b", {}, LABEL[a.tool] || a.tool), h("small", {}, summarize(a)))));
    if (a.tool !== "check_availability" && a.tool !== "find_bookings") {
      $(".msg", li).append(h("div", { class: `action ${a.ok ? "ok" : "warn"}` }, h("span", {}, ICON[a.tool] || "•"), summarize(a)));
    }
  }
  setCaller(caller);
}

function voiceFor(lang) {
  const voices = speechSynthesis.getVoices(), c = state.current, code = LANG_CODES[lang] || "en-GB";
  const chosen = voices.find((v) => v.name === c.voice.name);
  if (chosen && chosen.lang.slice(0, 2) === code.slice(0, 2)) return chosen;
  return voices.find((v) => v.lang === code) || voices.find((v) => v.lang.startsWith(code.slice(0, 2))) || null;
}
function speak(text) {
  if (!$("#speak").checked || !("speechSynthesis" in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text), lang = $("#call-lang").value;
  u.voice = voiceFor(lang); u.lang = u.voice?.lang || LANG_CODES[lang] || "en-GB"; u.rate = state.current.voice.rate;
  u.onstart = () => $("#phone").classList.add("speaking");
  u.onend = u.onerror = () => $("#phone").classList.remove("speaking");
  speechSynthesis.speak(u);
}
function tick() {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  $("#call-timer").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

$("#start").addEventListener("click", async () => {
  try {
    const { callId: id, greeting } = await api("POST", "/api/calls", { companyId: state.current.id });
    callId = id; caller = {};
    resetCallScreen();
    bubble("receptionist", greeting);
    speak(greeting);
    $("#idle-controls").classList.add("hidden"); $("#talk").classList.remove("hidden");
    setState("On call", "live");
    startedAt = Date.now(); clearInterval(timer); timer = setInterval(tick, 1000);
    $("#say").focus();
  } catch (e) { toast(e.message); }
});

$("#talk").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#say").value.trim();
  if (!text || !callId || $("#talk").classList.contains("busy")) return;
  $("#say").value = "";
  bubble("caller", text);
  setState(`${state.current.persona || "Receptionist"} is thinking…`, "thinking");
  $("#typing").classList.remove("hidden"); $("#talk").classList.add("busy");
  try {
    const out = await api("POST", `/api/calls/${callId}/turn`, { text });
    $("#typing").classList.add("hidden");
    const li = bubble("receptionist", out.reply || "…");
    addActions(li, out.actions);
    speak(out.reply);
    if (out.ended) endCallUi(`Call ended · ${out.ended.outcome.replaceAll("_", " ")}`);
    else setState("On call", "live");
  } catch (err) {
    $("#typing").classList.add("hidden");
    toast(err.message); setState("On call", "live");
  } finally { $("#talk").classList.remove("busy"); }
});

function endCallUi(text) {
  callId = null; clearInterval(timer);
  $("#talk").classList.add("hidden"); $("#idle-controls").classList.remove("hidden");
  setState(text, "ended");
}
function hangUp() {
  if (callId) api("POST", `/api/calls/${callId}/hangup`).catch(() => {});
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  endCallUi("You hung up");
}
$("#hangup").addEventListener("click", hangUp);

// Speech recognition (Chrome / Edge) in the chosen caller language; typing works everywhere.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Recognition) $("#mic").hidden = true;
$("#mic").addEventListener("click", () => {
  const rec = new Recognition();
  rec.lang = LANG_CODES[$("#call-lang").value] || "en-GB"; rec.interimResults = true;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  $("#mic").classList.add("listening"); setState("Listening…", "listening");
  rec.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    $("#say").value = r[0].transcript;
    if (r.isFinal) $("#talk").requestSubmit();
  };
  rec.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") toast(`Microphone: ${e.error}`); };
  rec.onend = () => { $("#mic").classList.remove("listening"); if (callId && $("#phone").dataset.mode === "listening") setState("On call", "live"); };
  rec.start();
});

/* ---------- Start ---------- */
(async () => {
  try {
    state.meta = await api("GET", "/api/meta");
    initSetup({ saved: (company) => reload(company?.id).then(() => company && showTab("setup")) });
    initDiary();
    await reload();
    const s = await api("GET", "/api/status");
    $("#key-status").replaceChildren(h("span", { class: `dot ${s.apiKeyConfigured ? "ok" : "warn"}` }), s.apiKeyConfigured ? "Claude connected" : "No API key — add it to .env");
  } catch (e) { toast(e.message); }
})();
