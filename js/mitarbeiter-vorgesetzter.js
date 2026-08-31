import { db, functions } from "./firebase.js";
import {
  collection,
  getDocs,
  addDoc,
  serverTimestamp,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { setHead } from "./app.js";
import { esc } from "./utils.js";
import { getEmployeePhotoUrls } from "./employee-photos.js";
import { calculateDailyTimeValues, wasStartLimited } from "./time-utils.js";
import { getAssignedUsers } from "./supervisor-utils.js";

const getSupervisorEmployeeContact = httpsCallable(
  functions,
  "getSupervisorEmployeeContact",
);
const fallback = (name = "") => {
  const p = String(name).trim().split(/\s+/).filter(Boolean);
  return (
    p.length > 1
      ? `${p[0][0]}${p[p.length - 1][0]}`
      : (p[0] || "MA").slice(0, 2)
  ).toUpperCase();
};

const value = (v) => esc(v || "–");

function bookingToDate(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function bookingPad(v) {
  return String(v).padStart(2, "0");
}
function bookingDateKey(record) {
  if (record.recordType === "adjustment")
    return String(record.adjustmentDate || "");
  const d = bookingToDate(record.startAt);
  if (d)
    return `${d.getFullYear()}-${bookingPad(d.getMonth() + 1)}-${bookingPad(d.getDate())}`;
  return String(record.date || "");
}
function bookingTime(record, kind) {
  const d = bookingToDate(kind === "start" ? record.startAt : record.endAt);
  if (d) return `${bookingPad(d.getHours())}:${bookingPad(d.getMinutes())}`;
  return String(record[kind] || "");
}
function bookingMinutesText(minutes, { signed = false } = {}) {
  const value = Math.round(Number(minutes) || 0);
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : "";
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 60)}:${bookingPad(abs % 60)} h`;
}
function bookingNetMinutes(record) {
  if (record.recordType === "adjustment")
    return Number(record.adjustmentMinutes) || 0;
  const start = bookingToDate(record.startAt),
    end = bookingToDate(record.endAt);
  if (!start || !end || end < start) return null;
  const gross = Math.max(0, Math.round((end - start) / 60000));
  const pause = gross > 540 ? 45 : gross > 360 ? 30 : 0;
  return Math.max(0, gross - pause);
}
function bookingSourceLabel(record) {
  if (record.recordType === "adjustment") return "Stundenkorrektur";
  if (record.source === "nfc_terminal") return "NFC-Terminal";
  if (record.source === "approved_request") return "genehmigter Antrag";
  if (record.source === "desktop_stamp") return "Personalmanagement";
  if (record.source === "supervisor_adjustment")
    return "Vorgesetzten-Korrektur";
  return record.source ? String(record.source) : "Buchung";
}
function bookingMonthLabel(date) {
  return date.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}
async function renderSupervisorBookings(container, employee) {
  let records = [];
  try {
    const snap = await getDocs(
      query(collection(db, "timeRecords"), where("userId", "==", employee.id)),
    );
    records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Zeitbuchungen konnten nicht geladen werden", err);
    container.innerHTML =
      '<div class="error-card compact">Die Zeitbuchungen konnten nicht geladen werden.</div>';
    return;
  }

  const bookingValues = calculateDailyTimeValues(records, employee.earliestStartTime || "", { includeOpen: true });

  let month = new Date();
  month = new Date(month.getFullYear(), month.getMonth(), 1, 12);

  const renderMonth = () => {
    const year = month.getFullYear(),
      monthNo = month.getMonth() + 1;
    const monthRecords = records
      .filter((r) =>
        bookingDateKey(r).startsWith(`${year}-${bookingPad(monthNo)}-`),
      )
      .sort((a, b) => {
        const ak = bookingDateKey(a) + bookingTime(a, "start");
        const bk = bookingDateKey(b) + bookingTime(b, "start");
        return bk.localeCompare(ak);
      });

    container.innerHTML = `
      <div class="employee-bookings-toolbar">
        <div class="actions">
          <button class="btn secondary small" type="button" data-booking-nav="prev">← Vorheriger Monat</button>
          <button class="btn secondary small" type="button" data-booking-nav="current">Aktueller Monat</button>
          <button class="btn secondary small" type="button" data-booking-nav="next">Nächster Monat →</button>
        </div>
        <strong>${esc(bookingMonthLabel(month))}</strong>
      </div>
      <div class="table-wrap"><table class="employee-bookings-table">
        <thead><tr><th>Datum</th><th>Projekt</th><th>KOMMEN</th><th>GEHEN</th><th>Arbeitszeit</th><th>Buchungsart</th><th>Terminal / Hinweis</th></tr></thead>
        <tbody>
          ${
            monthRecords.length
              ? monthRecords
                  .map((r) => {
                    if (r.recordType === "adjustment") {
                      const note = [r.adjustmentReason, r.adjustmentDetails]
                        .filter(Boolean)
                        .join(" · ");
                      return `<tr class="adjustment-row"><td>${esc(bookingDateKey(r).split("-").reverse().join("."))}</td><td>${esc(r.projectNumber || "–")}</td><td colspan="2"><strong>Stundenkorrektur</strong></td><td><strong>${esc(bookingMinutesText(r.adjustmentMinutes, { signed: true }))}</strong></td><td>${esc(bookingSourceLabel(r))}</td><td>${esc(note || r.createdByName || "–")}</td></tr>`;
                    }
                    const calc = bookingValues.get(r.id);
                    const net = calc ? calc.net : bookingNetMinutes(r);
                    const open =
                      !bookingToDate(r.endAt) && r.status !== "closed";
                    const terminal = [
                      r.terminalName || r.terminalId,
                      r.terminalEndId &&
                      r.terminalEndId !== (r.terminalId || "")
                        ? `GEHEN: ${r.terminalEndId}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return `<tr>
              <td>${esc(bookingDateKey(r).split("-").reverse().join("."))}</td>
              <td>${esc(r.projectNumber || "–")}</td>
              <td>${esc(bookingTime(r, "start") || "–")}${wasStartLimited(r,employee.earliestStartTime||"")?`<small class="booking-note start-limit-note">anrechenbar ab ${esc(employee.earliestStartTime)} Uhr</small>`:""}</td>
              <td>${esc(bookingTime(r, "end") || "–")}</td>
              <td>${net === null ? (open ? '<span class="pill yellow">läuft</span>' : "–") : esc(bookingMinutesText(net))}</td>
              <td>${esc(bookingSourceLabel(r))}</td>
              <td>${esc(terminal || (open ? "offene Buchung" : "–"))}</td>
            </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="7" class="empty">Für ${esc(bookingMonthLabel(month))} sind keine Buchungen vorhanden.</td></tr>`
          }
        </tbody>
      </table></div>`;

    container.querySelector('[data-booking-nav="prev"]').onclick = () => {
      month = new Date(month.getFullYear(), month.getMonth() - 1, 1, 12);
      renderMonth();
    };
    container.querySelector('[data-booking-nav="current"]').onclick = () => {
      const now = new Date();
      month = new Date(now.getFullYear(), now.getMonth(), 1, 12);
      renderMonth();
    };
    container.querySelector('[data-booking-nav="next"]').onclick = () => {
      month = new Date(month.getFullYear(), month.getMonth() + 1, 1, 12);
      renderMonth();
    };
  };

  renderMonth();
}


function formatHistoryDate(value) {
  if (!value) return "–";
  if (value?.toDate) return value.toDate().toLocaleString("de-DE");
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split("-").reverse().join(".");
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("de-DE");
}
function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "–";
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n)
    : "–";
}
async function renderSupervisorSalaryHistory(container, employee) {
  try {
    const snap = await getDocs(query(collection(db, "salaryHistory"), where("userId", "==", employee.id)));
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => String(b.validFrom || "").localeCompare(String(a.validFrom || "")));
    container.innerHTML = rows.length
      ? `<div class="table-wrap"><table class="compact-table"><thead><tr><th>Gültig ab</th><th>Monatsgehalt</th><th>Stundenlohn</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(formatHistoryDate(r.validFrom))}</td><td>${esc(formatMoney(r.grossSalary))}</td><td>${esc(r.hourlyRate == null ? "–" : `${formatMoney(r.hourlyRate)} / h`)}</td></tr>`).join("")}</tbody></table></div>`
      : '<div class="empty">Noch keine Vergütungshistorie vorhanden.</div>';
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="error-card compact">Die Vergütungshistorie konnte nicht geladen werden.</div>';
  }
}
async function renderSupervisorNotes(container, employee, ctx) {
  try {
    const snap = await getDocs(query(collection(db, "employeeNotes"), where("employeeId", "==", employee.id), where("authorId", "==", ctx.profile.id)));
    const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }))
      .filter(r => r.authorId === ctx.profile.id)
      .sort((a,b) => String(b.noteDate || "").localeCompare(String(a.noteDate || "")) || ((b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
    const today = new Date().toISOString().slice(0,10);
    container.innerHTML = `<div class="form-grid supervisor-note-form"><label class="field full"><span>Notiz</span><textarea id="supervisor-note-text" placeholder="Freitext zur internen Dokumentation"></textarea></label><label class="field"><span>Datum</span><input id="supervisor-note-date" type="date" value="${today}"></label><div class="field"><span>&nbsp;</span><button type="button" class="btn secondary" id="supervisor-note-add">Übernehmen</button><small>Sie sehen ausschließlich Ihre eigenen Notizen zu diesem Mitarbeiter.</small></div></div><div class="note-history-list">${rows.length ? rows.map(r => `<article class="note-history-entry"><div class="note-history-head"><strong>${esc(formatHistoryDate(r.noteDate))}</strong><span>${esc(r.authorName || "Vorgesetzter")}</span></div><p>${esc(r.text || "")}</p><small>erfasst ${esc(formatHistoryDate(r.createdAt))}</small></article>`).join("") : '<div class="empty">Noch keine eigenen Notizen vorhanden.</div>'}</div>`;
    const btn = container.querySelector("#supervisor-note-add");
    btn.onclick = async () => {
      const textValue = container.querySelector("#supervisor-note-text").value.trim();
      const noteDate = container.querySelector("#supervisor-note-date").value;
      if (!textValue || !noteDate) return;
      try {
        btn.disabled = true;
        await addDoc(collection(db, "employeeNotes"), {
          employeeId: employee.id,
          employeeName: employee.name || "",
          text: textValue,
          noteDate,
          authorId: ctx.profile.id,
          authorName: ctx.profile.name || ctx.profile.email || "",
          authorRole: "supervisor",
          createdAt: serverTimestamp()
        });
        await renderSupervisorNotes(container, employee, ctx);
      } finally {
        btn.disabled = false;
      }
    };
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="error-card compact">Notizen konnten nicht geladen werden.</div>';
  }
}

export async function renderSupervisorMitarbeiter(el, ctx) {
  setHead(
    "Mitarbeiter",
    "Ihre direkt zugeordneten Mitarbeiter und deren freigegebene Kontaktdaten und Zeitbuchungen.",
  );
  const assignedUsers = await getAssignedUsers(db, ctx.user.uid);
  const employees = assignedUsers
    .filter((u) => u.active !== false && u.archived !== true)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "de"));
  let photoUrls = {};
  try {
    photoUrls = await getEmployeePhotoUrls(
      ctx,
      employees.map((x) => x.id),
    );
  } catch (err) {
    console.warn("Mitarbeiterfotos konnten nicht geladen werden", err);
  }
  el.innerHTML = `<article class="card"><div class="card-head"><div><h2>Meine Mitarbeiter</h2><p>${employees.length} direkt zugeordnete Mitarbeiter</p></div></div>${employees.length ? `<div class="supervisor-employee-grid">${employees.map((u) => `<button type="button" class="supervisor-employee-card" data-id="${u.id}"><span class="employee-list-photo">${photoUrls[u.id] ? `<img src="${esc(photoUrls[u.id])}" alt="Foto von ${esc(u.name || "Mitarbeiter")}">` : `<span>${fallback(u.name)}</span>`}</span><span class="supervisor-employee-copy"><strong>${esc(u.name || "Mitarbeiter")}</strong><small>${esc(u.position || u.department || "")}</small><em>Mitarbeiternr. ${esc(u.employeeNumber || "–")}</em></span><span class="supervisor-employee-arrow">›</span></button>`).join("")}</div>` : '<div class="empty">Ihnen sind aktuell keine Mitarbeiter direkt zugeordnet.</div>'}</article><section id="supervisor-employee-detail"></section>`;
  el.querySelectorAll(".supervisor-employee-card").forEach(
    (button) =>
      (button.onclick = async () => {
        const employee = employees.find((x) => x.id === button.dataset.id);
        if (!employee) return;
        const detail = el.querySelector("#supervisor-employee-detail");
        detail.innerHTML =
          '<div class="loading">Kontaktdaten und Zeitbuchungen werden geladen …</div>';
        try {
          const token = await ctx.user.getIdToken();
          const result = await getSupervisorEmployeeContact({
            idToken: token,
            employeeId: employee.id,
          });
          const p = result.data?.contact || {};
          detail.innerHTML = `<div class="employee-file supervisor-readonly-file"><div class="employee-file-head"><div class="supervisor-profile-head"><span class="employee-profile-photo large">${photoUrls[employee.id] ? `<img src="${esc(photoUrls[employee.id])}" alt="Foto von ${esc(employee.name || "Mitarbeiter")}">` : `<span>${fallback(employee.name)}</span>`}</span><div><span class="eyebrow">Mitarbeiteransicht</span><h2>${esc(employee.name || "Mitarbeiter")}</h2><p>${esc(employee.position || employee.department || "")}</p></div></div></div><section class="employee-section"><div class="employee-section-head"><span class="employee-section-icon">⌂</span><div><h3>Persönliche Daten & Kontakt</h3><p>Freigegebene Kontaktdaten des zugeordneten Mitarbeiters. Nur Lesezugriff.</p></div></div><div class="readonly-contact-grid"><div><span>Geburtsdatum</span><strong>${value(p.birthDate)}</strong></div><div><span>Private E-Mail</span><strong>${value(p.privateEmail)}</strong></div><div class="full"><span>Anschrift</span><strong>${value([p.street, [p.postalCode, p.city].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</strong></div><div><span>Telefon</span><strong>${value(p.phone)}</strong></div><div><span>Mobil</span><strong>${value(p.mobile)}</strong></div><div><span>Notfallkontakt</span><strong>${value(p.emergencyContactName)}</strong></div><div><span>Telefon Notfallkontakt</span><strong>${value(p.emergencyContactPhone)}</strong></div></div></section><section class="employee-section"><div class="employee-section-head"><span class="employee-section-icon">↗</span><div><h3>Lohn & Gehalt – Historie</h3><p>Datierte Vergütungsentwicklung des zugeordneten Mitarbeiters. Nur Lesezugriff.</p></div></div><div id="supervisor-salary-history"><div class="loading">Vergütungshistorie wird geladen …</div></div></section><section class="employee-section"><div class="employee-section-head"><span class="employee-section-icon">✎</span><div><h3>Notizen</h3><p>Eigene interne Notizen zu diesem Mitarbeiter. Andere Vorgesetzten- oder Admin-Notizen sind nicht sichtbar.</p></div></div><div id="supervisor-employee-notes"><div class="loading">Notizen werden geladen …</div></div></section><section class="employee-section"><div class="employee-section-head"><span class="employee-section-icon">◴</span><div><h3>Buchungen</h3><p>Arbeitszeitbuchungen des zugeordneten Mitarbeiters. Nur Lesezugriff.</p></div></div><div id="supervisor-employee-bookings" class="employee-bookings-box"><div class="loading">Buchungen werden geladen …</div></div></section></div>`;
          const bookingBox = detail.querySelector(
            "#supervisor-employee-bookings",
          );
          await Promise.all([
            renderSupervisorBookings(bookingBox, employee),
            renderSupervisorSalaryHistory(detail.querySelector("#supervisor-salary-history"), employee),
            renderSupervisorNotes(detail.querySelector("#supervisor-employee-notes"), employee, ctx)
          ]);
          detail.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (err) {
          console.error(err);
          detail.innerHTML = `<div class="error-card"><strong>Kontaktdaten und Zeitbuchungen konnten nicht geladen werden.</strong><p>${esc(err?.message || "Keine Berechtigung.")}</p></div>`;
        }
      }),
  );
}
