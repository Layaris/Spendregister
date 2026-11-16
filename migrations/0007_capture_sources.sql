-- Da quale carta o banca arriva una notifica: le automazioni iPhone non lo dicono, quindi Ledgy lo impara.
-- Chiave = app (Android) oppure titolo della notifica (iPhone), in minuscolo. Quando l'utente scrive la carta
-- o cambia il conto di un movimento catturato, la scelta vale per le notifiche successive con la stessa chiave.
CREATE TABLE capture_sources (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  card TEXT,
  account_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
