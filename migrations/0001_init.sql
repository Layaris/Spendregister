-- Ledgy: schema iniziale.
-- Importi: interi in millesimi dell'unità (1,50 € = 1500; 55.600 IDR = 55600000).
-- Segno: negativo = uscita dal conto, positivo = entrata.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  currency TEXT NOT NULL DEFAULT 'EUR',
  initial_balance INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  external_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES categories(id),
  kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'income')),
  nature TEXT CHECK (nature IN ('must', 'need', 'want')),
  color TEXT,
  icon TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  external_id TEXT
);

CREATE TABLE labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  external_id TEXT
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
  account_id TEXT REFERENCES accounts(id),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  amount_eur INTEGER NOT NULL,
  fx_rate REAL,
  fx_date TEXT,
  occurred_at TEXT NOT NULL,          -- ora locale del telefono, con fuso (per giorni e regole)
  occurred_utc TEXT NOT NULL,         -- stessa ora in UTC (per ordinare e confrontare)
  merchant_raw TEXT,
  merchant TEXT,
  note TEXT,
  category_id TEXT REFERENCES categories(id),
  nature TEXT CHECK (nature IN ('must', 'need', 'want')),
  card TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'review')),
  review_reason TEXT,
  review_choices TEXT,
  transfer_group TEXT,
  duplicate_of TEXT,
  capture_id TEXT,
  rule_ids TEXT,
  place TEXT,
  lat REAL,
  lng REAL,
  external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX tx_occurred ON transactions(occurred_at);
CREATE INDEX tx_occurred_utc ON transactions(occurred_utc);
CREATE INDEX tx_status ON transactions(status);
CREATE INDEX tx_merchant ON transactions(merchant);
CREATE INDEX tx_category ON transactions(category_id);
CREATE UNIQUE INDEX tx_external ON transactions(external_id) WHERE external_id IS NOT NULL;

CREATE TABLE transaction_labels (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, label_id)
);

CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Lettori: come leggere le notifiche di una specifica app o banca.
CREATE TABLE parsers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  app TEXT NOT NULL,
  pattern TEXT NOT NULL,
  flags TEXT NOT NULL DEFAULT 'i',
  direction TEXT NOT NULL DEFAULT 'expense' CHECK (direction IN ('expense', 'income')),
  default_currency TEXT,
  sample TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Ogni telefono collegato ha il suo indirizzo privato (token).
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  method TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  last_capture_at TEXT,
  revoked_at TEXT
);

-- Ogni notifica ricevuta, anche quelle scartate: serve per capire cosa non va.
CREATE TABLE captures (
  id TEXT PRIMARY KEY,
  device_id TEXT REFERENCES devices(id),
  received_at TEXT NOT NULL,
  posted_at TEXT,
  app TEXT,
  title TEXT,
  text TEXT NOT NULL,
  hint TEXT,
  hash TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  transaction_id TEXT
);
CREATE INDEX captures_received ON captures(received_at);
CREATE INDEX captures_hash ON captures(hash);

CREATE TABLE fx_rates (
  date TEXT NOT NULL,
  currency TEXT NOT NULL,
  eur_per_unit REAL NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (date, currency)
);
