// Nomi leggibili delle app più comuni (pacchetti Android verificati sul Play Store, nomi iOS).
export const KNOWN_APPS: Record<string, string> = {
  'com.revolut.revolut': 'Revolut',
  'com.transferwise.android': 'Wise',
  'com.jago.digitalBanking': 'Jago',
  'id.co.bankbkemobile.digitalbank': 'SeaBank',
  'com.bca': 'BCA',
  'com.grabtaxi.passenger': 'Grab',
  'com.gojek.app': 'Gojek',
  'com.google.android.apps.walletnfcrel': 'Google Wallet',
  'com.apple.Passbook': 'Apple Wallet',
};

/** Le automazioni iPhone non dicono da quale app arriva la notifica: la si ricava dal titolo, se possibile. */
export function guessAppFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = title.toLowerCase();
  for (const [pkg, name] of Object.entries(KNOWN_APPS)) if (t.includes(name.toLowerCase())) return pkg;
  return null;
}

export function appLabel(app: string | null | undefined): string | null {
  if (!app) return null;
  if (KNOWN_APPS[app]) return KNOWN_APPS[app];
  const lower = app.toLowerCase();
  for (const [pkg, name] of Object.entries(KNOWN_APPS)) if (pkg.toLowerCase() === lower || name.toLowerCase() === lower) return name;
  return app.includes('.') ? app.split('.').pop() ?? app : app;
}
