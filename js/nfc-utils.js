export function randomToken(bytes = 24) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function nfcSupported() {
  return typeof window !== 'undefined' && 'NDEFReader' in window && window.isSecureContext;
}

export function makeEmployeeNfcPayload(token) {
  return `TPPM1|${token}`;
}

export function parseEmployeeNfcPayload(value) {
  const text = String(value || '').trim();
  return text.startsWith('TPPM1|') ? text.slice(6) : '';
}

export async function writeEmployeeNfcTag(token) {
  if (!nfcSupported()) throw new Error('Web NFC ist auf diesem Gerät/Browser nicht verfügbar. Bitte Google Chrome auf einem NFC-fähigen Android-Gerät verwenden.');
  const ndef = new NDEFReader();
  await ndef.write({ records: [{ recordType: 'text', data: makeEmployeeNfcPayload(token), lang: 'de' }] });
}

export function readTextRecord(record) {
  if (!record || record.recordType !== 'text') return '';
  try { return new TextDecoder(record.encoding || 'utf-8').decode(record.data); }
  catch (_) { return new TextDecoder().decode(record.data); }
}
