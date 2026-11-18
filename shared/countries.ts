// Paese dalla valuta della spesa: chi paga in baht è in Thailandia. Non serve la posizione e vale anche per le spese
// catturate dalle notifiche. L'euro e il dollaro valgono per più paesi: si chiamano "Zona euro" e "Stati Uniti".
export interface Country { name: string; flag: string }

const C: Record<string, [string, string]> = {
  IDR: ['Indonesia', '🇮🇩'], EUR: ['Zona euro', '🇪🇺'], USD: ['Stati Uniti', '🇺🇸'], SGD: ['Singapore', '🇸🇬'], THB: ['Thailandia', '🇹🇭'],
  MYR: ['Malesia', '🇲🇾'], PHP: ['Filippine', '🇵🇭'], VND: ['Vietnam', '🇻🇳'], KHR: ['Cambogia', '🇰🇭'], LAK: ['Laos', '🇱🇦'],
  MMK: ['Myanmar', '🇲🇲'], BND: ['Brunei', '🇧🇳'], AED: ['Emirati Arabi', '🇦🇪'], QAR: ['Qatar', '🇶🇦'], SAR: ['Arabia Saudita', '🇸🇦'],
  OMR: ['Oman', '🇴🇲'], BHD: ['Bahrein', '🇧🇭'], KWD: ['Kuwait', '🇰🇼'], JOD: ['Giordania', '🇯🇴'], TRY: ['Turchia', '🇹🇷'],
  AUD: ['Australia', '🇦🇺'], NZD: ['Nuova Zelanda', '🇳🇿'], JPY: ['Giappone', '🇯🇵'], KRW: ['Corea del Sud', '🇰🇷'], CNY: ['Cina', '🇨🇳'],
  HKD: ['Hong Kong', '🇭🇰'], TWD: ['Taiwan', '🇹🇼'], MOP: ['Macao', '🇲🇴'], INR: ['India', '🇮🇳'], LKR: ['Sri Lanka', '🇱🇰'],
  NPR: ['Nepal', '🇳🇵'], MVR: ['Maldive', '🇲🇻'], BDT: ['Bangladesh', '🇧🇩'], PKR: ['Pakistan', '🇵🇰'], GBP: ['Regno Unito', '🇬🇧'],
  CHF: ['Svizzera', '🇨🇭'], SEK: ['Svezia', '🇸🇪'], NOK: ['Norvegia', '🇳🇴'], DKK: ['Danimarca', '🇩🇰'], PLN: ['Polonia', '🇵🇱'],
  CZK: ['Repubblica Ceca', '🇨🇿'], HUF: ['Ungheria', '🇭🇺'], RON: ['Romania', '🇷🇴'], BGN: ['Bulgaria', '🇧🇬'], ISK: ['Islanda', '🇮🇸'],
  ALL: ['Albania', '🇦🇱'], RSD: ['Serbia', '🇷🇸'], BAM: ['Bosnia', '🇧🇦'], MKD: ['Macedonia del Nord', '🇲🇰'], GEL: ['Georgia', '🇬🇪'],
  CAD: ['Canada', '🇨🇦'], MXN: ['Messico', '🇲🇽'], BRL: ['Brasile', '🇧🇷'], ARS: ['Argentina', '🇦🇷'], CLP: ['Cile', '🇨🇱'],
  COP: ['Colombia', '🇨🇴'], PEN: ['Perù', '🇵🇪'], CRC: ['Costa Rica', '🇨🇷'], ZAR: ['Sudafrica', '🇿🇦'], MAD: ['Marocco', '🇲🇦'],
  EGP: ['Egitto', '🇪🇬'], TND: ['Tunisia', '🇹🇳'], KES: ['Kenya', '🇰🇪'], TZS: ['Tanzania', '🇹🇿'], MUR: ['Mauritius', '🇲🇺'],
  SCR: ['Seychelles', '🇸🇨'], ILS: ['Israele', '🇮🇱'], FJD: ['Figi', '🇫🇯'], XPF: ['Polinesia francese', '🇵🇫'],
};

export function countryOf(currency: string): Country {
  const c = C[currency.toUpperCase()];
  return c ? { name: c[0], flag: c[1] } : { name: currency.toUpperCase(), flag: '🌐' };
}

export interface DayRow { currency: string; day: string; spent: number; count: number }
export interface Stay { from: string; to: string; days: number; spent: number; count: number }

const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400_000);

/**
 * Soggiorni in un paese: giorni con spese nella sua valuta, uniti se tra uno e l'altro passano al massimo `gap` giorni.
 * Un giorno solo con una o due spese (es. un abbonamento in dollari) non è un soggiorno.
 */
export function staysOf(days: DayRow[], gap = 4): Stay[] {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const out: Stay[] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && dayNum(d.day) - dayNum(last.to) <= gap) {
      last.to = d.day;
      last.days += 1;
      last.spent += d.spent;
      last.count += d.count;
    } else out.push({ from: d.day, to: d.day, days: 1, spent: d.spent, count: d.count });
  }
  return out.filter((s) => s.days >= 2 || s.count >= 3);
}
