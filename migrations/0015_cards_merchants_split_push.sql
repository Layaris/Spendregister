-- Ricarico sul cambio di ogni carta, calcolato da una spesa di cui il proprietario ha scritto quanto ha addebitato
-- la carta nella sua valuta (markup_bp: centesimi di punto percentuale, 210 = 2,10%).
CREATE TABLE card_settings (
  user_id TEXT NOT NULL,
  card TEXT NOT NULL,
  currency TEXT,
  markup_bp INTEGER,
  sample_tx_id TEXT,
  sample_charged INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, card)
);

-- Nomi diversi dello stesso negozio: alias (minuscolo) → nome scelto. Vale per lo storico (già rinominato) e per il futuro.
CREATE TABLE merchant_aliases (
  user_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  merchant TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, alias)
);

-- Spesa divisa in più categorie: le parti hanno lo stesso split_group.
ALTER TABLE transactions ADD COLUMN split_group TEXT;
CREATE INDEX IF NOT EXISTS tx_split ON transactions(split_group) WHERE split_group IS NOT NULL;

-- Notifiche dell'app installata (web push). Il server manda solo una "sveglia" senza contenuto; il telefono legge il
-- testo da notify_queue. Le iscrizioni sono per dispositivo e non vanno nel backup.
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_ok_at TEXT
);
CREATE INDEX push_user ON push_subscriptions(user_id);
CREATE TABLE notify_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  dedupe TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,
  created_at TEXT NOT NULL,
  shown_at TEXT,
  UNIQUE (user_id, dedupe)
);
CREATE INDEX notify_user ON notify_queue(user_id, created_at);
