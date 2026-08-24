import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  updateDoc,
  doc,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, fmtDate, fmtDateTime, statusPill, toast } from "./utils.js";

function mins(t) {
  if (!t) return 0;
  const [a, b] = String(t).split(":").map(Number);
  return (a || 0) * 60 + (b || 0);
}

function hm(m) {
  const safe = Math.max(0, Math.round(Number(m) || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")} h`;
}

function pad(v) {
  return String(v).padStart(2, "0");
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTime(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDate(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function combineLocal(dateKey, time) {
  if (!dateKey || !time) return null;
  const d = new Date(`${dateKey}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function recordStartDate(record) {
  const fromStamp = toDate(record.startAt);
  if (fromStamp) return fromStamp;
  if (record.date && record.start) return combineLocal(record.date, record.start);
  return null;
}

function recordEndDate(record) {
  const fromStamp = toDate(record.endAt);
  if (fromStamp) return fromStamp;
  if (record.date && record.end) return combineLocal(record.date, record.end);
  return null;
}

function recordDateKey(record) {
  const start = recordStartDate(record);
  return record.date || (start ? localDateKey(start) : "");
}

function recordTime(record, kind) {
  const d = kind === "start" ? recordStartDate(record) : recordEndDate(record);
  if (d) return localTime(d);
  return record[kind] || "";
}

function calcRecord(record) {
  const start = recordStartDate(record);
  const end = recordEndDate(record);
  if (!start || !end) return { gross: 0, pause: 0, net: 0 };
  const gross = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const pause = gross > 540 ? 45 : gross > 360 ? 30 : 0;
  return { gross, pause, net: Math.max(0, gross - pause) };
}

function isOpen(record) {
  return !!recordStartDate(record) && !recordEndDate(record) && record.status !== "closed";
}

function requestLabel(req) {
  return req.requestType === "missing_record" ? "Nachträgliche Erfassung" : "Korrektur";
}

function statusLabel(status) {
  if (status === "approved") return statusPill("Genehmigt", "green");
  if (status === "rejected") return statusPill("Abgelehnt", "red");
  return statusPill("Beantragt", "yellow");
}

function requestedTimesText(req) {
  const date = fmtDate(req.requestedDate);
  return `${date} · ${esc(req.requestedStart || "–")} – ${esc(req.requestedEnd || "–")}`;
}

function currentTimesText(req) {
  if (req.requestType !== "correction") return "";
  return `${fmtDate(req.originalDate)} · ${esc(req.originalStart || "–")} – ${esc(req.originalEnd || "–")}`;
}

async function loadOwnRecords(userId) {
  const snap = await getDocs(query(collection(db, "timeRecords"), where("userId", "==", userId)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const aa = recordStartDate(a)?.getTime() || 0;
      const bb = recordStartDate(b)?.getTime() || 0;
      return bb - aa;
    });
}

async function loadOwnRequests(userId) {
  const snap = await getDocs(query(collection(db, "timeCorrectionRequests"), where("userId", "==", userId)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const aa = toDate(a.createdAt)?.getTime() || 0;
      const bb = toDate(b.createdAt)?.getTime() || 0;
      return bb - aa;
    });
}

async function loadTeamRequests(ctx) {
  if (ctx.profile.role === "employee") return [];
  const snap = await getDocs(collection(db, "timeCorrectionRequests"));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => r.status === "pending" && (ctx.profile.role === "admin" || r.supervisorId === ctx.profile.id))
    .sort((a, b) => {
      const aa = toDate(a.createdAt)?.getTime() || 0;
      const bb = toDate(b.createdAt)?.getTime() || 0;
      return aa - bb;
    });
}

function missingRequestForm(ctx) {
  return `
    <div class="request-panel hidden" id="missing-request-panel">
      <div class="request-panel-head">
        <div><strong>Nachträgliche Zeiterfassung beantragen</strong><span>Nur für Tage, an denen keine vollständige Stempelung vorliegt.</span></div>
        <button class="btn small secondary" type="button" id="close-missing-request">Schließen</button>
      </div>
      <form id="missing-request-form" class="form-grid">
        <label class="field"><span>Datum</span><input name="requestedDate" type="date" required max="${localDateKey()}"></label>
        <div></div>
        <label class="field"><span>Gewünschter Beginn</span><input name="requestedStart" type="time" required></label>
        <label class="field"><span>Gewünschtes Ende</span><input name="requestedEnd" type="time" required></label>
        <label class="field full"><span>Begründung *</span><textarea name="reason" required minlength="3" placeholder="Warum konnte die Arbeitszeit nicht regulär gestempelt werden?"></textarea></label>
        <div class="field full"><button class="btn primary" type="submit">Antrag senden</button></div>
      </form>
    </div>`;
}

function correctionRequestForm() {
  return `
    <div class="request-panel hidden" id="correction-request-panel">
      <div class="request-panel-head">
        <div><strong>Korrektur beantragen</strong><span id="correction-current-text"></span></div>
        <button class="btn small secondary" type="button" id="close-correction-request">Schließen</button>
      </div>
      <form id="correction-request-form" class="form-grid">
        <input type="hidden" name="recordId">
        <input type="hidden" name="requestedDate">
        <input type="hidden" name="originalStart">
        <input type="hidden" name="originalEnd">
        <label class="field"><span>Gewünschter Beginn</span><input name="requestedStart" type="time" required></label>
        <label class="field"><span>Gewünschtes Ende</span><input name="requestedEnd" type="time" required></label>
        <label class="field full"><span>Begründung *</span><textarea name="reason" required minlength="3" placeholder="Bitte begründen Sie die gewünschte Korrektur."></textarea></label>
        <div class="field full"><button class="btn primary" type="submit">Korrektur beantragen</button></div>
      </form>
    </div>`;
}

export async function renderZeiterfassung(el, ctx) {
  setHead("Zeiterfassung", "Arbeitszeit stempeln, Buchungen einsehen und notwendige Korrekturen beantragen.");

  let entries = [];
  let ownRequests = [];
  let teamRequests = [];
  try { entries = await loadOwnRecords(ctx.profile.id); } catch (e) { console.error("Zeitdaten konnten nicht geladen werden", e); }
  try { ownRequests = await loadOwnRequests(ctx.profile.id); } catch (e) { console.error("Zeitanträge konnten nicht geladen werden", e); }
  try { teamRequests = await loadTeamRequests(ctx); } catch (e) { console.error("Team-Zeitanträge konnten nicht geladen werden", e); }

  const openRecord = entries.find(isOpen) || null;
  const pendingRecordIds = new Set(
    ownRequests.filter(r => r.status === "pending" && r.requestType === "correction").map(r => r.recordId)
  );

  const openText = openRecord
    ? `Arbeitsbeginn heute um ${esc(recordTime(openRecord, "start"))} Uhr`
    : "Aktuell ist keine Arbeitszeit gestartet.";

  el.innerHTML = `
    <div class="two-col time-top-grid">
      <article class="card">
        <div class="card-head"><div><h2>Anträge zur Zeiterfassung</h2><p>Nachträgliche Erfassungen und Korrekturen werden erst nach Freigabe wirksam.</p></div></div>
        <div class="info-strip">Bereits gestempelte Zeiten können nicht direkt geändert werden. Für jede nachträgliche Änderung ist eine Begründung erforderlich.</div>
        <button class="btn secondary" type="button" id="open-missing-request">+ Nachträgliche Zeiterfassung beantragen</button>
        ${missingRequestForm(ctx)}
        ${correctionRequestForm()}
        <div class="request-list-head"><strong>Meine Anträge</strong><span>${ownRequests.length} Einträge</span></div>
        <div class="request-list">
          ${ownRequests.length ? ownRequests.map(r => `
            <div class="request-row">
              <div>
                <strong>${requestLabel(r)}</strong>
                <span>${requestedTimesText(r)}</span>
                ${r.requestType === "correction" ? `<small>Ursprünglich: ${currentTimesText(r)}</small>` : ""}
                <small>Begründung: ${esc(r.reason || "–")}</small>
                ${r.decisionNote ? `<small>Rückmeldung: ${esc(r.decisionNote)}</small>` : ""}
              </div>
              ${statusLabel(r.status)}
            </div>`).join("") : `<div class="empty compact-empty">Noch keine Zeitanträge vorhanden.</div>`}
        </div>
      </article>

      <article class="card stamp-card">
        <div class="card-head"><div><h2>Arbeitszeit stempeln</h2><p>Die tatsächliche Uhrzeit wird beim Klick automatisch übernommen.</p></div></div>
        <div class="stamp-clock"><span id="stamp-date"></span><strong id="stamp-clock"></strong></div>
        <div class="terminal-preview active-terminal">
          <button class="terminal-btn" id="clock-in-btn" type="button" ${openRecord ? "disabled" : ""}>KOMMEN</button>
          <button class="terminal-btn outline" id="clock-out-btn" type="button" ${openRecord ? "" : "disabled"}>GEHEN</button>
          <p class="stamp-status ${openRecord ? "running" : ""}">${openText}</p>
        </div>
      </article>
    </div>

    <article class="card">
      <div class="card-head"><div><h2>Meine Buchungen</h2><p>Gespeicherte Arbeitszeiten. Änderungen sind ausschließlich über einen Korrekturantrag möglich.</p></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Datum</th><th>Beginn</th><th>Ende</th><th>Pause</th><th>Arbeitszeit</th><th>Status</th><th>Aktion</th></tr></thead>
        <tbody>
          ${entries.length ? entries.map(r => {
            const c = calcRecord(r);
            const open = isOpen(r);
            const pending = pendingRecordIds.has(r.id);
            return `<tr>
              <td>${fmtDate(recordDateKey(r))}</td>
              <td>${esc(recordTime(r, "start") || "–")}</td>
              <td>${esc(recordTime(r, "end") || "–")}</td>
              <td>${open ? "–" : hm(c.pause)}</td>
              <td>${open ? "–" : `<strong>${hm(c.net)}</strong>`}</td>
              <td>${open ? statusPill("läuft", "blue") : statusPill("erfasst", "green")}</td>
              <td>${open ? `<span class="muted-small">erst nach Gehen</span>` : pending ? statusPill("Korrektur beantragt", "yellow") : `<button class="btn small secondary correction-btn" type="button" data-id="${r.id}">Korrektur beantragen</button>`}</td>
            </tr>`;
          }).join("") : `<tr><td colspan="7" class="empty">Noch keine Buchungen vorhanden.</td></tr>`}
        </tbody>
      </table></div>
    </article>

    ${ctx.profile.role !== "employee" ? `
      <article class="card">
        <div class="card-head"><div><h2>Freigaben Zeiterfassung</h2><p>Offene Anträge ${ctx.profile.role === "admin" ? "aller Mitarbeiter" : "Ihrer zugeordneten Mitarbeiter"}.</p></div></div>
        <div class="approval-list">
          ${teamRequests.length ? teamRequests.map(r => `
            <div class="time-approval-row">
              <div class="time-approval-copy">
                <strong>${esc(r.userName || r.userId)}</strong>
                <span>${requestLabel(r)} · ${requestedTimesText(r)}</span>
                ${r.requestType === "correction" ? `<small>Ursprünglich: ${currentTimesText(r)}</small>` : ""}
                <small><b>Begründung:</b> ${esc(r.reason || "–")}</small>
              </div>
              <div class="time-approval-actions">
                <input class="decision-note" data-id="${r.id}" placeholder="Rückmeldung (optional)">
                <div class="actions"><button class="btn small approve-time" type="button" data-id="${r.id}">Genehmigen</button><button class="btn small danger reject-time" type="button" data-id="${r.id}">Ablehnen</button></div>
              </div>
            </div>`).join("") : `<div class="empty">Keine offenen Freigaben.</div>`}
        </div>
      </article>` : ""}
  `;

  const clockDateEl = document.getElementById("stamp-date");
  const clockTimeEl = document.getElementById("stamp-clock");
  const tick = () => {
    const now = new Date();
    if (clockDateEl) clockDateEl.textContent = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(now);
    if (clockTimeEl) clockTimeEl.textContent = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
  };
  tick();
  const clockTimer = setInterval(() => {
    if (!document.body.contains(clockTimeEl)) { clearInterval(clockTimer); return; }
    tick();
  }, 1000);

  document.getElementById("clock-in-btn").onclick = async () => {
    try {
      await addDoc(collection(db, "timeRecords"), {
        userId: ctx.profile.id,
        userName: ctx.profile.name || ctx.profile.email || ctx.profile.id,
        companyId: ctx.profile.companyId || null,
        supervisorId: ctx.profile.supervisorId || null,
        source: "desktop_stamp",
        status: "open",
        startAt: serverTimestamp(),
        createdAt: serverTimestamp()
      });
      toast("Arbeitsbeginn wurde gestempelt.");
      renderZeiterfassung(el, ctx);
    } catch (e) {
      console.error(e);
      toast("Kommen konnte nicht gespeichert werden.");
    }
  };

  document.getElementById("clock-out-btn").onclick = async () => {
    if (!openRecord) return;
    try {
      await updateDoc(doc(db, "timeRecords", openRecord.id), {
        endAt: serverTimestamp(),
        status: "closed",
        endedAt: serverTimestamp()
      });
      toast("Arbeitsende wurde gestempelt.");
      renderZeiterfassung(el, ctx);
    } catch (e) {
      console.error(e);
      toast("Gehen konnte nicht gespeichert werden.");
    }
  };

  const missingPanel = document.getElementById("missing-request-panel");
  const correctionPanel = document.getElementById("correction-request-panel");
  document.getElementById("open-missing-request").onclick = () => {
    correctionPanel.classList.add("hidden");
    missingPanel.classList.remove("hidden");
  };
  document.getElementById("close-missing-request").onclick = () => missingPanel.classList.add("hidden");
  document.getElementById("close-correction-request").onclick = () => correctionPanel.classList.add("hidden");

  document.getElementById("missing-request-form").onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    if (!String(data.reason || "").trim()) { toast("Eine Begründung ist erforderlich."); return; }
    if (mins(data.requestedEnd) <= mins(data.requestedStart)) { toast("Die Endzeit muss nach der Startzeit liegen."); return; }
    const sameDate = entries.some(r => recordDateKey(r) === data.requestedDate && (recordStartDate(r) || recordEndDate(r)));
    if (sameDate) {
      const ok = confirm("Für diesen Tag existiert bereits eine Buchung. Möchten Sie trotzdem einen Antrag zur nachträglichen Erfassung stellen? Bei einer fehlerhaften Buchung ist normalerweise ‚Korrektur beantragen‘ die bessere Wahl.");
      if (!ok) return;
    }
    await addDoc(collection(db, "timeCorrectionRequests"), {
      requestType: "missing_record",
      userId: ctx.profile.id,
      userName: ctx.profile.name || ctx.profile.email || ctx.profile.id,
      companyId: ctx.profile.companyId || null,
      supervisorId: ctx.profile.supervisorId || null,
      requestedDate: data.requestedDate,
      requestedStart: data.requestedStart,
      requestedEnd: data.requestedEnd,
      reason: String(data.reason).trim(),
      status: "pending",
      createdAt: serverTimestamp()
    });
    toast("Antrag wurde gesendet.");
    renderZeiterfassung(el, ctx);
  };

  el.querySelectorAll(".correction-btn").forEach(btn => {
    btn.onclick = () => {
      const record = entries.find(r => r.id === btn.dataset.id);
      if (!record) return;
      missingPanel.classList.add("hidden");
      correctionPanel.classList.remove("hidden");
      const form = document.getElementById("correction-request-form");
      form.elements.recordId.value = record.id;
      form.elements.requestedDate.value = recordDateKey(record);
      form.elements.originalStart.value = recordTime(record, "start");
      form.elements.originalEnd.value = recordTime(record, "end");
      form.elements.requestedStart.value = recordTime(record, "start");
      form.elements.requestedEnd.value = recordTime(record, "end");
      form.elements.reason.value = "";
      document.getElementById("correction-current-text").textContent = `Aktuell: ${fmtDate(recordDateKey(record))} · ${recordTime(record, "start") || "–"} – ${recordTime(record, "end") || "–"}`;
      correctionPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    };
  });

  document.getElementById("correction-request-form").onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    if (!String(data.reason || "").trim()) { toast("Eine Begründung ist erforderlich."); return; }
    if (mins(data.requestedEnd) <= mins(data.requestedStart)) { toast("Die Endzeit muss nach der Startzeit liegen."); return; }
    if (data.requestedStart === data.originalStart && data.requestedEnd === data.originalEnd) { toast("Bitte ändern Sie mindestens eine Uhrzeit."); return; }
    await addDoc(collection(db, "timeCorrectionRequests"), {
      requestType: "correction",
      recordId: data.recordId,
      userId: ctx.profile.id,
      userName: ctx.profile.name || ctx.profile.email || ctx.profile.id,
      companyId: ctx.profile.companyId || null,
      supervisorId: ctx.profile.supervisorId || null,
      originalDate: data.requestedDate,
      originalStart: data.originalStart,
      originalEnd: data.originalEnd,
      requestedDate: data.requestedDate,
      requestedStart: data.requestedStart,
      requestedEnd: data.requestedEnd,
      reason: String(data.reason).trim(),
      status: "pending",
      createdAt: serverTimestamp()
    });
    toast("Korrekturantrag wurde gesendet.");
    renderZeiterfassung(el, ctx);
  };

  const decide = async (button, approved) => {
    const req = teamRequests.find(r => r.id === button.dataset.id);
    if (!req) return;
    const note = el.querySelector(`.decision-note[data-id="${req.id}"]`)?.value?.trim() || "";
    try {
      if (approved) {
        const startDate = combineLocal(req.requestedDate, req.requestedStart);
        const endDate = combineLocal(req.requestedDate, req.requestedEnd);
        if (!startDate || !endDate || endDate <= startDate) throw new Error("Ungültige beantragte Arbeitszeit.");

        if (req.requestType === "missing_record") {
          await addDoc(collection(db, "timeRecords"), {
            userId: req.userId,
            userName: req.userName || req.userId,
            companyId: req.companyId || null,
            supervisorId: req.supervisorId || null,
            source: "approved_request",
            status: "closed",
            startAt: Timestamp.fromDate(startDate),
            endAt: Timestamp.fromDate(endDate),
            approvedRequestId: req.id,
            approvedBy: ctx.profile.id,
            approvedByName: ctx.profile.name || ctx.profile.email || ctx.profile.id,
            approvedAt: serverTimestamp(),
            createdAt: serverTimestamp()
          });
        } else {
          await updateDoc(doc(db, "timeRecords", req.recordId), {
            startAt: Timestamp.fromDate(startDate),
            endAt: Timestamp.fromDate(endDate),
            status: "closed",
            correctedByRequestId: req.id,
            correctedBy: ctx.profile.id,
            correctedByName: ctx.profile.name || ctx.profile.email || ctx.profile.id,
            correctedAt: serverTimestamp()
          });
        }
      }

      await updateDoc(doc(db, "timeCorrectionRequests", req.id), {
        status: approved ? "approved" : "rejected",
        decisionNote: note,
        decidedBy: ctx.profile.id,
        decidedByName: ctx.profile.name || ctx.profile.email || ctx.profile.id,
        decidedAt: serverTimestamp()
      });
      toast(approved ? "Zeitantrag wurde genehmigt." : "Zeitantrag wurde abgelehnt.");
      renderZeiterfassung(el, ctx);
    } catch (e) {
      console.error(e);
      toast("Der Antrag konnte nicht bearbeitet werden.");
    }
  };

  el.querySelectorAll(".approve-time").forEach(b => b.onclick = () => decide(b, true));
  el.querySelectorAll(".reject-time").forEach(b => b.onclick = () => decide(b, false));
}
