// Negozi con nomi diversi: la stessa catena arriva come "STARBUCKS SEMINYAK", "Starbucks Coffee", "PT Starbucks".
// merchantKey toglie quello che cambia (maiuscole, accenti, numeri del punto vendita, sigle societarie);
// suggestMerges propone i gruppi da unire, che l'utente conferma uno per uno.

const LEGAL = new Set(['pt', 'cv', 'tbk', 'ud', 'srl', 'snc', 'sas', 'ltd', 'llc', 'inc', 'co', 'corp', 'gmbh', 'ag', 'bv', 'sa', 'sdn', 'bhd', 'pte', 'plc', 'the', 'store', 'shop', 'toko']);

export function merchantKey(name: string | null | undefined): string {
  if (!name) return '';
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !LEGAL.has(w) && !/^\d+$/.test(w) && !/^[a-z]?\d{2,}[a-z]?$/.test(w));
  return words.join(' ');
}

export interface MerchantCount { merchant: string; n: number }

// Prime parole che non dicono quale negozio è (in Bali "Warung Made" e "Warung Babi Guling" sono due posti diversi).
const GENERIC = new Set([
  'warung', 'toko', 'rumah', 'kedai', 'depot', 'bengkel', 'apotek', 'klinik', 'hotel', 'villa', 'resort', 'homestay', 'guest', 'house',
  'cafe', 'caffe', 'coffee', 'kopi', 'restaurant', 'restoran', 'ristorante', 'trattoria', 'pizzeria', 'bakery', 'bar', 'pub', 'bistro',
  'kitchen', 'grill', 'sushi', 'pizza', 'burger', 'gelato', 'spa', 'salon', 'laundry', 'market', 'supermarket', 'minimarket', 'mart',
  'pharmacy', 'farmacia', 'bank', 'pasar', 'mini', 'super', 'new', 'grand', 'royal', 'bali', 'beach', 'little', 'big', 'happy', 'green',
  'pt', 'cv', 'ud', 'the', 'la', 'le', 'il', 'el', 'di', 'da', 'de', 'and', 'my', 'mr', 'mrs', 'sun', 'blue', 'red', 'black', 'white', 'golden',
]);

/** Prima parola che identifica la marca ("starbucks"), se è abbastanza lunga e non è generica. */
function brandWord(key: string): string | null {
  const w = key.split(' ')[0];
  return w && w.length >= 5 && !GENERIC.has(w) ? w : null;
}

/** Gruppi di nomi che sembrano lo stesso negozio: stessa chiave, stessa prima parola di marca ("Starbucks Seminyak",
 *  "Starbucks Coffee"), oppure una chiave è l'inizio dell'altra a fine parola (almeno 5 lettere).
 *  Il nome proposto è quello usato più spesso. */
export function suggestMerges(items: MerchantCount[], max = 30): { into: string; names: string[]; n: number }[] {
  const byKey = new Map<string, MerchantCount[]>();
  for (const it of items) {
    const k = merchantKey(it.merchant);
    if (k.length < 3) continue;
    const g = brandWord(k) ?? k;
    const list = byKey.get(g);
    if (list) list.push(it);
    else byKey.set(g, [it]);
  }
  // Chiavi più corte per prime: ognuna raccoglie quelle che iniziano con lei.
  const keys = [...byKey.keys()].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const taken = new Set<string>();
  const groups: { into: string; names: string[]; n: number }[] = [];
  for (const k of keys) {
    if (taken.has(k)) continue;
    const members = [...byKey.get(k)!];
    if (k.replace(/ /g, '').length >= 5) {
      for (const other of keys) {
        if (other !== k && !taken.has(other) && other.startsWith(`${k} `)) {
          members.push(...byKey.get(other)!);
          taken.add(other);
        }
      }
    }
    taken.add(k);
    if (members.length < 2) continue;
    members.sort((a, b) => b.n - a.n || a.merchant.length - b.merchant.length);
    groups.push({ into: members[0].merchant, names: members.map((m) => m.merchant), n: members.reduce((a, m) => a + m.n, 0) });
  }
  return groups.sort((a, b) => b.n - a.n).slice(0, max);
}
