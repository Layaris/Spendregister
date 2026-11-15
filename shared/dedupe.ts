// Doppioni: la stessa notifica può arrivare da più telefoni o essere reinviata.

export interface DedupeCandidate {
  amount: number;
  currency: string;
  merchant_raw: string | null;
  occurred_at: string;
}

const WINDOW_MS = 3 * 60 * 1000;

function merchantKey(m: string | null): string {
  return (m ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
}

export function isLikelyDuplicate(a: DedupeCandidate, b: DedupeCandidate): boolean {
  if (a.amount !== b.amount || a.currency !== b.currency) return false;
  const dt = Math.abs(Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  if (!(dt <= WINDOW_MS)) return false;
  const ka = merchantKey(a.merchant_raw);
  const kb = merchantKey(b.merchant_raw);
  return !ka || !kb || ka === kb;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
