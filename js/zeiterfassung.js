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
  Timestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, fmtDate, fmtDateTime, statusPill, toast } from "./utils.js";
import { hasAdminPermission } from "./permissions.js";


function validProjectNumber(value) {
  return /^\d{6}$/.test(String(value || "").trim());
}

function projectText(value) {
  return validProjectNumber(value) ? String(value) : "–";
}

function mins(t) {
  if (!t) return 0;
  const [a, b] = String(t).split(":").map(Number);
  return (a || 0) * 60 + (b || 0);
}

function hm(m) {
  const safe = Math.max(0, Math.round(Number(m) || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")} h`;
}

function signedHm(m) {
  const value = Math.round(Number(m) || 0);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const safe = Math.abs(value);
  return `${sign}${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")} h`;
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
  if (record.recordType === "adjustment") return record.adjustmentDate || "";
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


function allocatedDayValues(records) {
  const result = new Map();
  const groups = new Map();
  records.filter(r => r.recordType !== "adjustment" && !isOpen(r)).forEach(r => {
    const c = calcRecord(r);
    const key = recordDateKey(r);
    if (!key || c.gross <= 0) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ record: r, gross: c.gross });
  });
  for (const items of groups.values()) {
    const totalGross = items.reduce((sum, x) => sum + x.gross, 0);
    const dayPause = totalGross > 540 ? 45 : totalGross > 360 ? 30 : 0;
    let allocated = 0;
    items.forEach((item, index) => {
      const pause = index === items.length - 1
        ? dayPause - allocated
        : Math.round(dayPause * (item.gross / totalGross));
      allocated += pause;
      result.set(item.record.id, { gross: item.gross, pause, net: Math.max(0, item.gross - pause) });
    });
  }
  return result;
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
  const project = validProjectNumber(req.projectNumber) ? ` · Projekt ${esc(req.projectNumber)}` : "";
  return `${date}${project} · ${esc(req.requestedStart || "–")} – ${esc(req.requestedEnd || "–")}`;
}

function currentTimesText(req) {
  if (req.requestType !== "correction") return "";
  const project = validProjectNumber(req.originalProjectNumber) ? ` · Projekt ${esc(req.originalProjectNumber)}` : "";
  return `${fmtDate(req.originalDate)}${project} · ${esc(req.originalStart || "–")} – ${esc(req.originalEnd || "–")}`;
}

async function loadOwnRecords(userId) {
  const snap = await getDocs(query(collection(db, "timeRecords"), where("userId", "==", userId)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const dateValue = r => {
        if (r.recordType === "adjustment" && r.adjustmentDate) {
          const d = new Date(`${r.adjustmentDate}T12:00:00`);
          if (!Number.isNaN(d.getTime())) return d.getTime();
        }
        return recordStartDate(r)?.getTime() || toDate(r.createdAt)?.getTime() || 0;
      };
      return dateValue(b) - dateValue(a);
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

function missingRequestForm(ctx, projectTracking) {
  return `
    <div class="request-panel hidden" id="missing-request-panel">
      <div class="request-panel-head">
        <div><strong>Nachträgliche Zeiterfassung beantragen</strong><span>Nur für Tage, an denen keine vollständige Stempelung vorliegt.</span></div>
        <button class="btn small secondary" type="button" id="close-missing-request">Schließen</button>
      </div>
      <form id="missing-request-form" class="form-grid">
        <label class="field"><span>Datum</span><input name="requestedDate" type="date" required max="${localDateKey()}"></label>
        ${projectTracking ? `<label class="field"><span>Projektnummer *</span><input name="projectNumber" class="project-number-input" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="6-stellig" required></label>` : ""}
        <label class="field"><span>Gewünschter Beginn</span><input name="requestedStart" type="time" required></label>
        <label class="field"><span>Gewünschtes Ende</span><input name="requestedEnd" type="time" required></label>
        <label class="field full"><span>Begründung *</span><textarea name="reason" required minlength="3" placeholder="Warum konnte die Arbeitszeit nicht regulär gestempelt werden?"></textarea></label>
        <div class="field full"><button class="btn primary" type="submit">Antrag senden</button></div>
      </form>
    </div>`;
}

function correctionRequestForm(projectTracking) {
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
        <input type="hidden" name="originalProjectNumber">
        ${projectTracking ? `<label class="field"><span>Projektnummer *</span><input name="projectNumber" class="project-number-input" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="6-stellig" required></label><div></div>` : `<input type="hidden" name="projectNumber" value="">`}
        <label class="field"><span>Gewünschter Beginn</span><input name="requestedStart" type="time" required></label>
        <label class="field"><span>Gewünschtes Ende</span><input name="requestedEnd" type="time" required></label>
        <label class="field full"><span>Begründung *</span><textarea name="reason" required minlength="3" placeholder="Bitte begründen Sie die gewünschte Korrektur."></textarea></label>
        <div class="field full"><button class="btn primary" type="submit">Korrektur beantragen</button></div>
      </form>
    </div>`;
}

export async function renderZeiterfassung(el, ctx) {
  setHead("Zeiterfassung", "Arbeitszeit stempeln, Buchungen einsehen und notwendige Korrekturen beantragen.");
  const projectTracking = ctx.profile.projectTimeTracking === true;

  let entries = [];
  let ownRequests = [];
  let teamRequests = [];
  let adjustmentEmployees = [];
  let recentAdjustments = [];
  const canBookAdjustments = ctx.profile.role === "supervisor" || hasAdminPermission(ctx.profile, "timeAdjustment");
  const canApproveTime = ctx.profile.role === "supervisor" || hasAdminPermission(ctx.profile, "timeApprove");
  try { entries = await loadOwnRecords(ctx.profile.id); } catch (e) { console.error("Zeitdaten konnten nicht geladen werden", e); }
  try { ownRequests = await loadOwnRequests(ctx.profile.id); } catch (e) { console.error("Zeitanträge konnten nicht geladen werden", e); }
  if (canApproveTime) { try { teamRequests = await loadTeamRequests(ctx); } catch (e) { console.error("Team-Zeitanträge konnten nicht geladen werden", e); } }
  if (canBookAdjustments) {
    try {
      if (ctx.profile.role === "admin") {
        const s = await getDocs(collection(db, "users"));
        adjustmentEmployees = s.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.active !== false && u.id !== ctx.profile.id)
          .sort((a,b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "de"));

        const t = await getDocs(collection(db, "timeRecords"));
        recentAdjustments = t.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(r => r.recordType === "adjustment");
      } else {
        // Vorgesetzte erhalten ausschließlich ihre organisatorisch zugeordneten Mitarbeiter.
        const s = await getDocs(
          query(collection(db, "users"), where("supervisorId", "==", ctx.profile.id))
        );
        adjustmentEmployees = s.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.active !== false && u.id !== ctx.profile.id)
          .sort((a,b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "de"));

        // Korrekturbuchungen werden je Teammitglied geladen. Dadurch bleibt die
        // Abfrage mit den Firestore-Berechtigungen des Vorgesetzten vereinbar.
        const teamAdjustmentLists = await Promise.all(
          adjustmentEmployees.map(async employee => {
            const t = await getDocs(
              query(collection(db, "timeRecords"), where("userId", "==", employee.id))
            );
            return t.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(r => r.recordType === "adjustment");
          })
        );
        recentAdjustments = teamAdjustmentLists.flat();
      }

      recentAdjustments = recentAdjustments
        .sort((a,b) => {
          const aa = a.adjustmentDate ? new Date(`${a.adjustmentDate}T12:00:00`).getTime() : toDate(a.createdAt)?.getTime() || 0;
          const bb = b.adjustmentDate ? new Date(`${b.adjustmentDate}T12:00:00`).getTime() : toDate(b.createdAt)?.getTime() || 0;
          return bb-aa;
        })
        .slice(0, 10);
    } catch (e) {
      console.error("Mitarbeiterliste/Korrekturbuchungen konnten nicht geladen werden", e);
    }
  }

  const openRecord = entries.find(isOpen) || null;
  const allocatedValues = allocatedDayValues(entries);
  const pendingRecordIds = new Set(
    ownRequests.filter(r => r.status === "pending" && r.requestType === "correction").map(r => r.recordId)
  );

  const openText = openRecord
    ? (projectTracking && validProjectNumber(openRecord.projectNumber)
        ? `Projekt ${esc(openRecord.projectNumber)} läuft seit ${esc(recordTime(openRecord, "start"))} Uhr`
        : `Arbeitszeit läuft seit ${esc(recordTime(openRecord, "start"))} Uhr`)
    : "Aktuell ist keine Arbeitszeit gestartet.";

  el.innerHTML = `
    <div class="two-col time-top-grid">
      <article class="card">
        <div class="card-head"><div><h2>Anträge zur Zeiterfassung</h2><p>Nachträgliche Erfassungen und Korrekturen werden erst nach Freigabe wirksam.</p></div></div>
        <div class="info-strip">Bereits gestempelte Zeiten können nicht direkt geändert werden. Für jede nachträgliche Änderung ist eine Begründung erforderlich.</div>
        <button class="btn secondary" type="button" id="open-missing-request">+ Nachträgliche Zeiterfassung beantragen</button>
        ${missingRequestForm(ctx, projectTracking)}
        ${correctionRequestForm(projectTracking)}
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
        ${projectTracking ? `<label class="field project-stamp-field"><span>Projektnummer *</span><input id="stamp-project-number" class="project-number-input project-stamp-input" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="6-stellige Projektnummer" autocomplete="off"></label>` : ""}
        <div class="terminal-preview active-terminal">
          <button class="terminal-btn" id="clock-in-btn" type="button" ${projectTracking || openRecord ? "disabled" : ""}>KOMMEN</button>
          <button class="terminal-btn outline" id="clock-out-btn" type="button" ${openRecord ? "" : "disabled"}>GEHEN</button>
          <p class="stamp-status ${openRecord ? "running" : ""}">${openText}</p>
          ${projectTracking ? `<p class="project-stamp-help">Bei einem Projektwechsel neue Projektnummer eingeben und erneut <strong>KOMMEN</strong> klicken. Das vorherige Projekt wird automatisch beendet.</p>` : ""}
        </div>
      </article>
    </div>

    ${canBookAdjustments ? `
    <article class="card admin-adjustment-card">
      <div class="card-head"><div><h2>Stundenkorrektur buchen</h2><p>${ctx.profile.role === "admin" ? "Manuelle Zu- oder Abbuchungen auf dem Stundenkonto werden als eigene Buchung protokolliert." : "Sie können Stundenkorrekturen ausschließlich für Ihre zugeordneten Mitarbeiter buchen."}</p></div></div>
      <div class="info-strip">Beispiele: Auszahlung von Überstunden, Übertrag/Korrektur oder Umwandlung eines Urlaubstages. Die Buchung ersetzt keine Kommen-/Gehen-Zeit und bleibt in der Buchungsliste nachvollziehbar.</div>
      <form id="admin-hours-adjustment-form" class="form-grid">
        <label class="field"><span>Mitarbeiter</span><select name="userId" id="admin-adjustment-user" required><option value="">Bitte wählen</option>${adjustmentEmployees.map(u => `<option value="${esc(u.id)}">${esc(u.name || u.email || u.username || u.id)}</option>`).join("")}</select></label>
        <label class="field"><span>Buchungsdatum</span><input name="adjustmentDate" type="date" required max="${localDateKey()}" value="${localDateKey()}"></label>
        <label class="field" id="admin-adjustment-project-field"><span>Projektnummer</span><input name="projectNumber" class="project-number-input" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="6-stellig (falls projektbezogen)"><small id="admin-adjustment-project-help">Optional. Bei Eingabe sind genau sechs Ziffern erforderlich.</small></label>
        <label class="field"><span>Buchungsart</span><select name="direction" required><option value="plus">Stunden gutschreiben (+)</option><option value="minus">Stunden abziehen (−)</option></select></label>
        <label class="field"><span>Grund</span><select name="reasonPreset" required><option value="">Bitte wählen</option><option>Auszahlung von Überstunden</option><option>Urlaubstag in Stunden umgewandelt</option><option>Übertrag / Stundenkorrektur</option><option>Sonstiges</option></select></label>
        <label class="field"><span>Stunden</span><input name="hours" type="number" min="0" max="999" step="1" value="0" required></label>
        <label class="field"><span>Minuten</span><input name="minutes" type="number" min="0" max="59" step="1" value="0" required></label>
        <label class="field full"><span>Bemerkung / Erläuterung</span><textarea name="reasonDetails" placeholder="Optional ergänzende Erläuterung; bei 'Sonstiges' erforderlich."></textarea></label>
        <div class="field full"><button class="btn primary" type="submit">Stundenkorrektur buchen</button></div>
      </form>
      <div class="request-list-head"><strong>Letzte Korrekturbuchungen</strong><span>${recentAdjustments.length} angezeigt</span></div>
      <div class="request-list">${recentAdjustments.length ? recentAdjustments.map(r => `
        <div class="request-row"><div><strong>${esc(r.userName || r.userId)} · ${signedHm(r.adjustmentMinutes)}</strong><span>${fmtDate(r.adjustmentDate)}${validProjectNumber(r.projectNumber) ? ` · Projekt ${esc(r.projectNumber)}` : ""} · ${esc(r.adjustmentReason || "Stundenkorrektur")}</span>${r.adjustmentDetails ? `<small>${esc(r.adjustmentDetails)}</small>` : ""}</div>${statusPill("gebucht", "blue")}</div>`).join("") : `<div class="empty compact-empty">Noch keine Stundenkorrekturen gebucht.</div>`}</div>
    </article>` : ""}

    <article class="card">
      <div class="card-head"><div><h2>Meine Buchungen</h2><p>Gespeicherte Arbeitszeiten und Stundenkorrekturen. Arbeitszeiten können ausschließlich über einen Korrekturantrag geändert werden.</p></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Datum</th><th>Projekt</th><th>Beginn</th><th>Ende</th><th>Pause</th><th>Arbeitszeit</th><th>Status</th><th>Aktion</th></tr></thead>
        <tbody>
          ${entries.length ? entries.map(r => {
            if (r.recordType === "adjustment") {
              const reason = [r.adjustmentReason, r.adjustmentDetails].filter(Boolean).join(" · ");
              return `<tr class="adjustment-row">
                <td>${fmtDate(recordDateKey(r))}</td>
                <td><strong>${esc(projectText(r.projectNumber))}</strong></td>
                <td colspan="3"><strong>Stundenkorrektur</strong><small class="booking-note">${esc(reason || "Korrekturbuchung")}</small></td>
                <td><strong class="adjustment-value ${Number(r.adjustmentMinutes) >= 0 ? "positive" : "negative"}">${signedHm(r.adjustmentMinutes)}</strong></td>
                <td>${statusPill("Admin-Buchung", "blue")}</td>
                <td><span class="muted-small">${esc(r.createdByName || "Personalabteilung")}</span></td>
              </tr>`;
            }
            const c = allocatedValues.get(r.id) || calcRecord(r);
            const open = isOpen(r);
            const pending = pendingRecordIds.has(r.id);
            return `<tr>
              <td>${fmtDate(recordDateKey(r))}</td>
              <td><strong>${esc(projectText(r.projectNumber))}</strong></td>
              <td>${esc(recordTime(r, "start") || "–")}</td>
              <td>${esc(recordTime(r, "end") || "–")}</td>
              <td>${open ? "–" : hm(c.pause)}</td>
              <td>${open ? "–" : `<strong>${hm(c.net)}</strong>`}</td>
              <td>${open ? statusPill("läuft", "blue") : statusPill("erfasst", "green")}</td>
              <td>${open ? `<span class="muted-small">erst nach Gehen</span>` : pending ? statusPill("Korrektur beantragt", "yellow") : `<button class="btn small secondary correction-btn" type="button" data-id="${r.id}">Korrektur beantragen</button>`}</td>
            </tr>`;
          }).join("") : `<tr><td colspan="8" class="empty">Noch keine Buchungen vorhanden.</td></tr>`}
        </tbody>
      </table></div>
    </article>

    ${canApproveTime ? `
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

  const adminAdjustmentForm = document.getElementById("admin-hours-adjustment-form");
  if (adminAdjustmentForm) {
    adminAdjustmentForm.onsubmit = async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.currentTarget).entries());
      const employee = adjustmentEmployees.find(u => u.id === data.userId);
      if (!employee) { toast("Bitte einen Mitarbeiter auswählen."); return; }
      const hours = Number(data.hours || 0);
      const minutes = Number(data.minutes || 0);
      const total = Math.round(hours * 60 + minutes);
      if (!Number.isFinite(total) || total <= 0) { toast("Bitte eine Stunden- oder Minutenanzahl größer 0 eingeben."); return; }
      if (minutes < 0 || minutes > 59) { toast("Minuten müssen zwischen 0 und 59 liegen."); return; }
      const details = String(data.reasonDetails || "").trim();
      const projectNumber = String(data.projectNumber || "").trim();
      if (projectNumber && !validProjectNumber(projectNumber)) { toast("Die Projektnummer muss genau sechs Ziffern enthalten."); return; }
      if (data.reasonPreset === "Sonstiges" && !details) { toast("Bei 'Sonstiges' ist eine Erläuterung erforderlich."); return; }
      const signedMinutes = data.direction === "minus" ? -total : total;
      try {
        await addDoc(collection(db, "timeRecords"), {
          recordType: "adjustment",
          source: ctx.profile.role === "admin" ? "admin_adjustment" : "supervisor_adjustment",
          status: "closed",
          userId: employee.id,
          userName: employee.name || employee.email || employee.username || employee.id,
          companyId: employee.companyId || null,
          supervisorId: employee.supervisorId || null,
          adjustmentDate: data.adjustmentDate,
          adjustmentMinutes: signedMinutes,
          adjustmentReason: String(data.reasonPreset || "Stundenkorrektur"),
          adjustmentDetails: details,
          projectNumber,
          projectTimeTracking: employee.projectTimeTracking === true,
          employeeNumber: employee.employeeNumber || "",
          companyAreaNumber: employee.companyAreaNumber || "",
          createdBy: ctx.profile.id,
          createdByName: ctx.profile.name || ctx.profile.email || ctx.profile.id,
          createdAt: serverTimestamp()
        });
        toast(`Stundenkorrektur ${signedHm(signedMinutes)} wurde für ${employee.name || employee.email || "den Mitarbeiter"} gebucht.`);
        renderZeiterfassung(el, ctx);
      } catch (err) {
        console.error(err);
        toast(err?.code === "permission-denied"
          ? "Keine Berechtigung für diese Stundenkorrektur."
          : "Die Stundenkorrektur konnte nicht gespeichert werden.");
      }
    };
  }

  const adminAdjustmentUser = document.getElementById("admin-adjustment-user");
  const adminAdjustmentProjectHelp = document.getElementById("admin-adjustment-project-help");
  if (adminAdjustmentUser && adminAdjustmentProjectHelp) {
    const updateAdminProjectHint = () => {
      const employee = adjustmentEmployees.find(u => u.id === adminAdjustmentUser.value);
      adminAdjustmentProjectHelp.textContent = employee?.projectTimeTracking === true
        ? "Dieser Mitarbeiter erfasst projektbezogen. Für projektwirksame Korrekturen bitte die sechsstellige Projektnummer angeben."
        : "Optional. Bei Eingabe sind genau sechs Ziffern erforderlich.";
    };
    adminAdjustmentUser.addEventListener("change", updateAdminProjectHint);
    updateAdminProjectHint();
  }

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

  const projectInput = document.getElementById("stamp-project-number");
  const clockInBtn = document.getElementById("clock-in-btn");
  const normalizeProjectInput = input => {
    input.value = String(input.value || "").replace(/\D/g, "").slice(0, 6);
  };
  el.querySelectorAll(".project-number-input").forEach(input => {
    input.addEventListener("input", () => {
      normalizeProjectInput(input);
      if (input === projectInput) clockInBtn.disabled = !validProjectNumber(input.value);
    });
  });
  if (projectTracking && projectInput) clockInBtn.disabled = !validProjectNumber(projectInput.value);
  if (!projectTracking) clockInBtn.disabled = !!openRecord;

  clockInBtn.onclick = async () => {
    const projectNumber = projectTracking ? String(projectInput?.value || "").trim() : "";
    if (projectTracking && !validProjectNumber(projectNumber)) { toast("Bitte eine sechsstellige Projektnummer eingeben."); return; }
    if (projectTracking && openRecord && String(openRecord.projectNumber || "") === projectNumber) {
      toast(`Projekt ${projectNumber} ist bereits aktiv.`);
      return;
    }
    if (!projectTracking && openRecord) {
      toast("Die Arbeitszeit läuft bereits. Bitte zuerst GEHEN stempeln.");
      return;
    }
    try {
      const newRecord = {
        userId: ctx.profile.id,
        userName: ctx.profile.name || ctx.profile.email || ctx.profile.id,
        employeeNumber: ctx.profile.employeeNumber || "",
        companyId: ctx.profile.companyId || null,
        companyNumber: ctx.company?.companyNumber || "",
        companyAreaNumber: ctx.profile.companyAreaNumber || "",
        projectTimeTracking: projectTracking,
        supervisorId: ctx.profile.supervisorId || null,
        projectNumber,
        source: "desktop_stamp",
        status: "open",
        startAt: serverTimestamp(),
        createdAt: serverTimestamp()
      };
      if (openRecord) {
        const batch = writeBatch(db);
        batch.update(doc(db, "timeRecords", openRecord.id), { endAt: serverTimestamp(), status: "closed", endedAt: serverTimestamp() });
        batch.set(doc(collection(db, "timeRecords")), newRecord);
        await batch.commit();
        toast(`Projekt ${projectText(openRecord.projectNumber)} beendet · Projekt ${projectNumber} gestartet.`);
      } else {
        await addDoc(collection(db, "timeRecords"), newRecord);
        toast(projectTracking ? `Arbeitszeit für Projekt ${projectNumber} wurde gestartet.` : "Arbeitszeit wurde gestartet.");
      }
      renderZeiterfassung(el, ctx);
    } catch (e) {
      console.error(e);
      toast("Kommen / Projektwechsel konnte nicht gespeichert werden.");
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
      toast(projectTracking && validProjectNumber(openRecord.projectNumber) ? `Arbeitsende für Projekt ${openRecord.projectNumber} wurde gestempelt.` : "Arbeitsende wurde gestempelt.");
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
    if (projectTracking && !validProjectNumber(data.projectNumber)) { toast("Bitte eine sechsstellige Projektnummer eingeben."); return; }
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
      companyNumber: ctx.company?.companyNumber || "",
      employeeNumber: ctx.profile.employeeNumber || "",
      companyAreaNumber: ctx.profile.companyAreaNumber || "",
      projectTimeTracking: projectTracking,
      supervisorId: ctx.profile.supervisorId || null,
      requestedDate: data.requestedDate,
      projectNumber: projectTracking ? String(data.projectNumber) : "",
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
      form.elements.originalProjectNumber.value = projectTracking ? (record.projectNumber || "") : "";
      form.elements.projectNumber.value = projectTracking ? (record.projectNumber || "") : "";
      form.elements.requestedStart.value = recordTime(record, "start");
      form.elements.requestedEnd.value = recordTime(record, "end");
      form.elements.reason.value = "";
      document.getElementById("correction-current-text").textContent = projectTracking && validProjectNumber(record.projectNumber)
        ? `Aktuell: ${fmtDate(recordDateKey(record))} · Projekt ${record.projectNumber} · ${recordTime(record, "start") || "–"} – ${recordTime(record, "end") || "–"}`
        : `Aktuell: ${fmtDate(recordDateKey(record))} · ${recordTime(record, "start") || "–"} – ${recordTime(record, "end") || "–"}`;
      correctionPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    };
  });

  document.getElementById("correction-request-form").onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    if (!String(data.reason || "").trim()) { toast("Eine Begründung ist erforderlich."); return; }
    if (projectTracking && !validProjectNumber(data.projectNumber)) { toast("Bitte eine sechsstellige Projektnummer eingeben."); return; }
    if (mins(data.requestedEnd) <= mins(data.requestedStart)) { toast("Die Endzeit muss nach der Startzeit liegen."); return; }
    const projectChanged = projectTracking && data.projectNumber !== data.originalProjectNumber;
    if (data.requestedStart === data.originalStart && data.requestedEnd === data.originalEnd && !projectChanged) { toast(projectTracking ? "Bitte ändern Sie mindestens eine Uhrzeit oder die Projektnummer." : "Bitte ändern Sie mindestens eine Uhrzeit."); return; }
    await addDoc(collection(db, "timeCorrectionRequests"), {
      requestType: "correction",
      recordId: data.recordId,
      userId: ctx.profile.id,
      userName: ctx.profile.name || ctx.profile.email || ctx.profile.id,
      companyId: ctx.profile.companyId || null,
      companyNumber: ctx.company?.companyNumber || "",
      employeeNumber: ctx.profile.employeeNumber || "",
      companyAreaNumber: ctx.profile.companyAreaNumber || "",
      projectTimeTracking: projectTracking,
      supervisorId: ctx.profile.supervisorId || null,
      originalDate: data.requestedDate,
      originalStart: data.originalStart,
      originalEnd: data.originalEnd,
      originalProjectNumber: data.originalProjectNumber || "",
      requestedDate: data.requestedDate,
      projectNumber: projectTracking ? String(data.projectNumber) : "",
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
            companyNumber: req.companyNumber || "",
            employeeNumber: req.employeeNumber || "",
            companyAreaNumber: req.companyAreaNumber || "",
            projectTimeTracking: req.projectTimeTracking === true,
            supervisorId: req.supervisorId || null,
            projectNumber: req.projectNumber,
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
            projectNumber: req.projectNumber,
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
