-- Categorie predefinite versione 2 (generiche, per tutto il mondo). Gli account esistenti restano alla
-- versione 1 e si aggiornano da soli al primo avvio dell'app (worker/seed.ts, upgradeCatalog).
ALTER TABLE users ADD COLUMN catalog_version INTEGER NOT NULL DEFAULT 1;
-- Impostazioni dell'account: valuta di visualizzazione e tema.
ALTER TABLE users ADD COLUMN display_currency TEXT NOT NULL DEFAULT 'EUR';
ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'light';
-- Preferiti: movimenti che si ripetono, da riusare con un tap.
CREATE TABLE favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
  amount REAL,
  currency TEXT NOT NULL,
  merchant TEXT,
  category_id TEXT,
  account_id TEXT,
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX favorites_user ON favorites(user_id, position);
