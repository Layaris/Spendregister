-- Account per più persone, come in Multifolio: email e password, ogni dato appartiene a un account.
-- I dati già presenti (della versione con una sola password) vanno all'account "owner", che il
-- proprietario collega alla sua email inserendo una volta la vecchia password.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  recovery_hash TEXT,
  recovery_created_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Makassar',
  created_at TEXT NOT NULL
);

INSERT INTO users (id, email, password_hash, recovery_hash, recovery_created_at, timezone, created_at)
VALUES (
  'owner', NULL,
  (SELECT value FROM settings WHERE key = 'password_hash'),
  (SELECT value FROM settings WHERE key = 'recovery_hash'),
  (SELECT value FROM settings WHERE key = 'recovery_created_at'),
  COALESCE((SELECT value FROM settings WHERE key = 'timezone'), 'Asia/Makassar'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
DELETE FROM settings WHERE key IN ('password_hash', 'recovery_hash', 'recovery_created_at', 'timezone');

-- Le sessioni aperte con la vecchia password si chiudono: si rientra collegando i dati a un'email.
DELETE FROM sessions;
ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE accounts ADD COLUMN user_id TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE categories ADD COLUMN user_id TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE transactions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE rules ADD COLUMN user_id TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE parsers ADD COLUMN user_id TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE devices ADD COLUMN user_id TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE captures ADD COLUMN user_id TEXT NOT NULL DEFAULT 'owner';

-- Le etichette erano uniche per nome in tutto il database: ora lo sono per account.
-- Si ricrea la tabella salvando prima i collegamenti ai movimenti, che altrimenti verrebbero cancellati.
CREATE TABLE tl_copy AS SELECT transaction_id, label_id FROM transaction_labels;
DELETE FROM transaction_labels;
CREATE TABLE labels_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  name TEXT NOT NULL,
  color TEXT,
  external_id TEXT,
  UNIQUE (user_id, name)
);
INSERT INTO labels_new (id, user_id, name, color, external_id) SELECT id, 'owner', name, color, external_id FROM labels;
DROP TABLE labels;
ALTER TABLE labels_new RENAME TO labels;
INSERT INTO transaction_labels (transaction_id, label_id) SELECT transaction_id, label_id FROM tl_copy;
DROP TABLE tl_copy;

DROP INDEX IF EXISTS tx_external;
CREATE UNIQUE INDEX tx_external ON transactions(user_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX tx_user_time ON transactions(user_id, occurred_utc);
CREATE INDEX categories_user ON categories(user_id);
CREATE INDEX accounts_user ON accounts(user_id);
CREATE INDEX rules_user ON rules(user_id);
CREATE INDEX parsers_user ON parsers(user_id);
CREATE INDEX devices_user ON devices(user_id);
CREATE INDEX captures_user ON captures(user_id, received_at);
CREATE INDEX sessions_user ON sessions(user_id);
