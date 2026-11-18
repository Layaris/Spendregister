-- Notifiche arrivate dai telefoni mentre il database non rispondeva (es. limite giornaliero superato):
-- si salvano qui con un solo INSERT, che non legge righe, e si registrano appena il database torna.
-- Il token del telefono non si salva: solo la sua impronta, come in devices.token_hash.
CREATE TABLE inbound_queue (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL,
  content_type TEXT,
  body TEXT NOT NULL,
  received_at TEXT NOT NULL
);
