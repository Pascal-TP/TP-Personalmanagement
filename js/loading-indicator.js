const activeOperations = new Map();
const DISPLAY_DELAY_MS = 350;
let sequence = 0;
let delayTimer = null;

function safeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function ensureElement() {
  let overlay = document.querySelector("#portal-loading-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "portal-loading-overlay";
  overlay.className = "portal-loading-overlay";
  overlay.hidden = true;
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-atomic", "true");
  overlay.innerHTML = `<div class="portal-loading-card"><span class="portal-loading-spinner" aria-hidden="true"></span><div><strong id="portal-loading-title">Inhalte werden geladen …</strong><span>Bitte einen Moment Geduld.</span></div></div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function paint() {
  try {
    const overlay = ensureElement();
    const latest = [...activeOperations.values()].sort((a, b) => b.sequence - a.sequence)[0];
    if (!latest) {
      overlay.hidden = true;
      return;
    }
    const title = overlay.querySelector("#portal-loading-title");
    if (title) title.textContent = safeText(latest.text, "Inhalte werden geladen …");
    overlay.hidden = false;
  } catch (error) {
    console.warn("Ladeanzeige konnte nicht aktualisiert werden.", error);
  }
}

export function beginPortalLoading(text = "Inhalte werden geladen …") {
  const operationId = Symbol("portal-loading-operation");
  activeOperations.set(operationId, { text: safeText(text, "Inhalte werden geladen …"), sequence: ++sequence });
  if (!delayTimer) {
    delayTimer = setTimeout(() => {
      delayTimer = null;
      if (activeOperations.size) paint();
    }, DISPLAY_DELAY_MS);
  } else {
    try {
      const overlay = document.querySelector("#portal-loading-overlay");
      if (overlay && !overlay.hidden) paint();
    } catch (error) {
      console.warn("Ladeanzeige konnte nicht aktualisiert werden.", error);
    }
  }
  return operationId;
}

export function endPortalLoading(operationId) {
  try {
    activeOperations.delete(operationId);
    if (!activeOperations.size && delayTimer) {
      clearTimeout(delayTimer);
      delayTimer = null;
    }
    paint();
  } catch (error) {
    console.warn("Ladeanzeige konnte nicht beendet werden.", error);
  }
}
