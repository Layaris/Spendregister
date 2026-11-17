-- Intelligenza artificiale per account: chiavi Gemini e NanoGPT (mai nei backup, mai restituite all'app),
-- modelli e stato (Gemini con le richieste gratuite finite si salta fino a gemini_paused_until).
CREATE TABLE ai_settings (
  user_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  gemini_key TEXT,
  nanogpt_key TEXT,
  gemini_model TEXT,
  nanogpt_model TEXT,
  gemini_paused_until TEXT,
  last_provider TEXT,
  last_error TEXT,
  last_used_at TEXT,
  updated_at TEXT NOT NULL
);
-- Home personalizzabile: elenco ordinato delle schede accese (JSON). NULL = disposizione predefinita.
ALTER TABLE users ADD COLUMN home_layout TEXT;
