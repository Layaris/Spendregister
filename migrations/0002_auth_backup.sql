-- Password modificabile dall'app, recupero via email, limite ai tentativi di accesso.

-- Tentativi di accesso falliti, per bloccare chi prova password a raffica.
CREATE TABLE login_attempts (
  key TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX login_attempts_key ON login_attempts(key, at);

-- Link di recupero password: si salva solo l'impronta del token.
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
