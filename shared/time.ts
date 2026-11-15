// Ore con il fuso: le spese si contano nel giorno e nell'ora locali di chi paga.

export const DEFAULT_TIMEZONE = 'Asia/Makassar';

export const TIMEZONES: Array<[string, string]> = [
  ['Asia/Makassar', 'Bali, Lombok (UTC+8)'],
  ['Asia/Jakarta', 'Giacarta, Sumatra (UTC+7)'],
  ['Asia/Jayapura', 'Papua (UTC+9)'],
  ['Asia/Singapore', 'Singapore, Malesia (UTC+8)'],
  ['Asia/Bangkok', 'Thailandia, Vietnam (UTC+7)'],
  ['Asia/Manila', 'Filippine (UTC+8)'],
  ['Asia/Tokyo', 'Giappone (UTC+9)'],
  ['Australia/Sydney', 'Sydney'],
  ['Europe/Rome', 'Italia'],
  ['Europe/London', 'Regno Unito'],
  ['UTC', 'UTC'],
];

const pad = (n: number) => String(n).padStart(2, '0');

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Scostamento in minuti del fuso rispetto a UTC in un dato istante. */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

function offsetString(min: number): string {
  const sign = min >= 0 ? '+' : '-';
  const abs = Math.abs(min);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** "2026-11-15T07:00:00+08:00": l'istante scritto nell'ora locale del fuso. */
export function zonedIso(at: Date, timeZone: string): string {
  const off = zoneOffsetMinutes(at, timeZone);
  const local = new Date(at.getTime() + off * 60000);
  const d = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const t = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
  return `${d}T${t}${offsetString(off)}`;
}

/**
 * Normalizza l'ora inviata dal telefono:
 * - con fuso esplicito (+08:00) resta com'è;
 * - in UTC (Z) o come numero (epoch) viene riscritta nel fuso scelto;
 * - senza fuso ("2026-11-15 14:32:08", tipico di MacroDroid) è già ora locale del fuso scelto;
 * - mancante o illeggibile: adesso, nel fuso scelto.
 */
export function normalizePostedAt(input: string | null | undefined, timeZone: string, now = new Date()): string {
  const s = (input ?? '').trim();
  if (!s) return zonedIso(now, timeZone);
  if (/^\d{10}(\d{3})?$/.test(s)) return zonedIso(new Date(s.length === 10 ? Number(s) * 1000 : Number(s)), timeZone);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return zonedIso(now, timeZone);
  const [, y, mo, d, h, mi, sec = '00', zone] = m;
  if (zone && zone.toUpperCase() !== 'Z') {
    const z = zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
    return `${y}-${mo}-${d}T${h}:${mi}:${sec}${z}`;
  }
  if (zone) return zonedIso(new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec}Z`), timeZone);
  // Ora locale senza fuso: si calcola lo scostamento del fuso in quel momento.
  const guess = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec));
  const off = zoneOffsetMinutes(new Date(guess.getTime() - zoneOffsetMinutes(guess, timeZone) * 60000), timeZone);
  return `${y}-${mo}-${d}T${h}:${mi}:${sec}${offsetString(off)}`;
}
