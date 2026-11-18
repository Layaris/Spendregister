-- Spese ricorrenti pagate fuori dalle carte che Ledgy legge (PayPal, bonifico, contanti): Ledgy le registra da sola
-- alla data (auto_add = 1), nel conto scelto, con l'importo e la valuta originali. Con auto_add = 0 aspetta la notifica.
ALTER TABLE recurring ADD COLUMN auto_add INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recurring ADD COLUMN account_id TEXT;
ALTER TABLE recurring ADD COLUMN amount INTEGER;
ALTER TABLE recurring ADD COLUMN currency TEXT;
