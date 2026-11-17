-- Meno righe lette (D1 gratuito: 5 milioni lette e 100.000 scritte al giorno, per tutto l'account Cloudflare).
-- Le date si confrontano direttamente su occurred_at (niente substr), così l'indice per utente e data funziona.

-- Indici vecchi su una colonna sola: non servono più (li coprono quelli per utente) e ogni indice costa una scrittura in più.
DROP INDEX IF EXISTS tx_occurred;
DROP INDEX IF EXISTS tx_status;
DROP INDEX IF EXISTS tx_merchant;
DROP INDEX IF EXISTS tx_category;

CREATE INDEX IF NOT EXISTS tx_user_occurred ON transactions(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS tx_user_merchant ON transactions(user_id, merchant COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS tx_user_category ON transactions(user_id, category_id);
-- Parziale: contiene solo le righe da rivedere, quindi costa poco.
CREATE INDEX IF NOT EXISTS tx_review ON transactions(user_id, occurred_utc) WHERE status = 'review';
-- Tentativi dell'AI per la categoria di un movimento: uno solo, poi resta "da rivedere" (niente chiamate ripetute).
ALTER TABLE transactions ADD COLUMN ai_tries INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS tx_labels_label ON transaction_labels(label_id);
CREATE INDEX IF NOT EXISTS trip_items_tx ON trip_items(transaction_id);

-- Totali per utente, conto e valuta dei movimenti validi (non cancellati, non doppioni), tenuti aggiornati dai trigger:
-- saldi dei conti e saldo totale si leggono da qui invece di sommare ogni volta tutto lo storico. Senza conto: account_id ''.
CREATE TABLE account_totals (
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  amount_eur INTEGER NOT NULL DEFAULT 0,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, account_id, currency)
);
INSERT INTO account_totals (user_id, account_id, currency, amount, amount_eur, n)
  SELECT user_id, COALESCE(account_id, ''), currency, SUM(amount), SUM(amount_eur), COUNT(*) FROM transactions
  WHERE deleted_at IS NULL AND duplicate_of IS NULL GROUP BY user_id, COALESCE(account_id, ''), currency;

CREATE TRIGGER tx_totals_insert AFTER INSERT ON transactions
WHEN NEW.deleted_at IS NULL AND NEW.duplicate_of IS NULL
BEGIN
  INSERT INTO account_totals (user_id, account_id, currency, amount, amount_eur, n)
    VALUES (NEW.user_id, COALESCE(NEW.account_id, ''), NEW.currency, NEW.amount, NEW.amount_eur, 1)
    ON CONFLICT (user_id, account_id, currency) DO UPDATE SET amount = amount + excluded.amount, amount_eur = amount_eur + excluded.amount_eur, n = n + 1;
END;

CREATE TRIGGER tx_totals_delete AFTER DELETE ON transactions
WHEN OLD.deleted_at IS NULL AND OLD.duplicate_of IS NULL
BEGIN
  UPDATE account_totals SET amount = amount - OLD.amount, amount_eur = amount_eur - OLD.amount_eur, n = n - 1
    WHERE user_id = OLD.user_id AND account_id = COALESCE(OLD.account_id, '') AND currency = OLD.currency;
END;

CREATE TRIGGER tx_totals_update AFTER UPDATE OF user_id, account_id, currency, amount, amount_eur, deleted_at, duplicate_of ON transactions
BEGIN
  UPDATE account_totals SET amount = amount - OLD.amount, amount_eur = amount_eur - OLD.amount_eur, n = n - 1
    WHERE user_id = OLD.user_id AND account_id = COALESCE(OLD.account_id, '') AND currency = OLD.currency
      AND OLD.deleted_at IS NULL AND OLD.duplicate_of IS NULL;
  INSERT INTO account_totals (user_id, account_id, currency, amount, amount_eur, n)
    SELECT NEW.user_id, COALESCE(NEW.account_id, ''), NEW.currency, NEW.amount, NEW.amount_eur, 1
    WHERE NEW.deleted_at IS NULL AND NEW.duplicate_of IS NULL
    ON CONFLICT (user_id, account_id, currency) DO UPDATE SET amount = amount + excluded.amount, amount_eur = amount_eur + excluded.amount_eur, n = n + 1;
END;

-- Statistiche per il pianificatore delle query, dopo i nuovi indici.
PRAGMA optimize;
