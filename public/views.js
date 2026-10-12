// Diary (week view of bookings) and Activity (stats, messages, transfers, call log).
import { $, h, api, toast, state, DAYS, isoDate, when, pretty } from "./ui.js";

let weekStart = mondayOf(new Date());
function mondayOf(d) { const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const endTime = (t, minutes) => { const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + minutes; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const fetchActivity = () => api("GET", `/api/companies/${state.current.id}/activity`);

/* ---------- Diary ---------- */
export async function renderDiary() {
  if (!state.current) return;
  const c = state.current, data = await fetchActivity().catch((e) => (toast(e.message), null));
  if (!data) return;
  const today = isoDate(new Date()), last = addDays(weekStart, 6);
  $("#wk-label").textContent = `${weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${last.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  $("#week").replaceChildren(...DAYS.map((d, i) => {
    const date = addDays(weekStart, i), iso = isoDate(date), hours = c.hours[d];
    const items = data.bookings.filter((b) => b.date === iso).sort((a, b) => a.time.localeCompare(b.time));
    return h("div", { class: `wday${iso === today ? " today" : ""}${hours ? "" : " shut"}` },
      h("div", { class: "wday-head" }, h("b", {}, date.toLocaleDateString("en-GB", { weekday: "short" })), h("span", {}, date.getDate()),
        h("small", {}, hours ? `${hours[0]}–${hours[1]}` : "Closed")),
      items.length ? items.map((b) => h("div", { class: `appt${b.status === "cancelled" ? " cancelled" : ""}` },
        h("b", {}, `${b.time}–${endTime(b.time, b.minutes ?? c.appointmentMinutes)}`),
        h("span", {}, b.service || "Appointment"),
        h("small", {}, `${b.callerName} · ${b.phone}`),
        b.notes && b.notes !== "none" ? h("small", { class: "notes" }, b.notes) : null,
        b.status === "cancelled" ? h("em", {}, "Cancelled") : h("button", { type: "button", class: "link", onclick: () => cancel(b) }, "Cancel"),
      )) : h("p", { class: "muted small" }, hours ? "Free" : ""));
  }));
}
async function cancel(b) {
  try { await api("POST", `/api/bookings/${b.id}/cancel`); toast("Booking cancelled.", "info"); renderDiary(); } catch (e) { toast(e.message); }
}
export function initDiary() {
  $("#wk-prev").addEventListener("click", () => { weekStart = addDays(weekStart, -7); renderDiary(); });
  $("#wk-next").addEventListener("click", () => { weekStart = addDays(weekStart, 7); renderDiary(); });
  $("#wk-today").addEventListener("click", () => { weekStart = mondayOf(new Date()); renderDiary(); });
}

/* ---------- Activity ---------- */
const empty = (msg) => h("p", { class: "muted small" }, msg);
export async function renderActivity() {
  if (!state.current) return;
  const a = await fetchActivity().catch((e) => (toast(e.message), null));
  if (!a) return;
  const live = a.bookings.filter((b) => b.status !== "cancelled");
  const stats = [
    ["📞", a.calls.length, "Calls answered"],
    ["✅", live.length, "Bookings"],
    ["✉️", a.messages.length, "Messages"],
    ["↪️", a.transfers.length, "Transfers"],
    ["⛔", a.calls.filter((c) => c.outcome === "spam").length, "Spam blocked"],
  ];
  $("#stats").replaceChildren(...stats.map(([icon, n, label]) => h("div", { class: "stat" }, h("span", {}, icon), h("b", {}, n), h("small", {}, label))));
  $("#act-messages").replaceChildren(...(a.messages.length ? a.messages.map((m) => h("div", { class: `item ${m.urgency}` },
    h("div", { class: "item-top" }, h("b", {}, m.callerName), h("span", { class: `tag ${m.urgency}` }, m.urgency)),
    h("p", {}, m.message), h("small", {}, `For ${m.forWhom} · ${m.phone} · ${when(m.createdAt)}`))) : [empty("No messages yet.")]));
  $("#act-transfers").replaceChildren(...(a.transfers.length ? a.transfers.map((t) => h("div", { class: "item" },
    h("div", { class: "item-top" }, h("b", {}, t.department), h("small", {}, when(t.createdAt))),
    h("p", {}, t.reason), h("small", {}, `${t.callerName} → ${t.contact}`))) : [empty("No transfers yet.")]));
  $("#act-calls").replaceChildren(...(a.calls.length ? a.calls.map((c) => h("details", { class: "log" },
    h("summary", {}, h("span", { class: `tag ${c.outcome || "live"}` }, pretty(c.outcome || "in progress")), h("b", {}, when(c.startedAt)), h("span", { class: "muted" }, c.summary || "No summary yet.")),
    h("ol", {}, (c.transcript || []).map((t) => h("li", { class: t.who }, h("b", {}, t.who === "caller" ? "Caller" : "Receptionist"), t.text))))) : [empty("No calls yet — start one from the Call tab.")]));
}
