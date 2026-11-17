-- Indici per leggere solo le righe che servono (piano gratuito D1: 5 milioni di righe lette al giorno).
-- Le date si confrontano direttamente su occurred_at (niente substr), così l'indice per utente e data funziona.
CREATE INDEX IF NOT EXISTS tx_user_occurred ON transactions(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS tx_user_merchant ON transactions(user_id, merchant COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS tx_user_category ON transactions(user_id, category_id);
CREATE INDEX IF NOT EXISTS tx_user_card ON transactions(user_id, card) WHERE card IS NOT NULL;
CREATE INDEX IF NOT EXISTS tx_labels_label ON transaction_labels(label_id);
CREATE INDEX IF NOT EXISTS trip_items_tx ON trip_items(transaction_id);
