-- Budget mensili: category_id = '*' è il budget totale (il tetto); le altre righe sono ritagli del totale per categoria.
-- Importi in millesimi di euro (positivi).
CREATE TABLE budgets (
  user_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, category_id)
);

-- Viaggi: luogo e date. Le spese restano nelle loro categorie; il viaggio è solo una vista.
-- trip_items: movimenti aggiunti (mode 'in', es. il volo comprato prima) o tolti (mode 'out') a mano.
CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  place TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX trips_user ON trips(user_id, start_date);
CREATE TABLE trip_items (
  user_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('in', 'out')),
  PRIMARY KEY (trip_id, transaction_id)
);

-- Spese ricorrenti: proposte dall'app e confermate (o scartate) dall'utente, oppure segnate a mano.
CREATE TABLE recurring (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  merchant TEXT NOT NULL,
  category_id TEXT,
  amount_eur INTEGER NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('week', 'month', 'year')),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'dismissed')),
  last_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX recurring_user_merchant ON recurring(user_id, merchant);

-- Funzioni facoltative accese (Impostazioni › Funzioni), JSON: {"weekly_summary": true, ...}. NULL = predefinite.
ALTER TABLE users ADD COLUMN features TEXT;
