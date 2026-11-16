-- Uso senza account: chi apre l'app è un "ospite" (account senza email) finché non crea un account.
-- I dati della versione con una sola password non servono (il proprietario non l'aveva ancora usata):
-- si toglie l'account "owner" con tutti i suoi dati, se non è stato collegato a un'email.
DELETE FROM transaction_labels WHERE transaction_id IN (SELECT id FROM transactions WHERE user_id = 'owner' AND (SELECT email FROM users WHERE id = 'owner') IS NULL);
DELETE FROM captures WHERE user_id = 'owner' AND (SELECT email FROM users WHERE id = 'owner') IS NULL;
DELETE FROM transactions WHERE user_id = 'owner' AND (SELECT email FROM users WHERE id = 'owner') IS NULL;
DELETE FROM rules WHERE user_id = 'owner' AND (SELECT email FROM users WHERE id = 'owner') IS NULL;
DELETE FROM parsers WHERE user_id = 'owner' AND (SELECT email FROM users WHERE id = 'owner') IS NULL;
DELETE FROM devices WHERE user_id = 'owner' AND (SELECT email FROM users WHERE id = 'owner') IS NULL;
DELETE FROM labels WHERE user_id = 'owner' AND (SELECT email FROM users WHERE id = 'owner') IS NULL;
DELETE FROM categories WHERE user_id = 'owner' AND (SELECT email FROM users WHERE id = 'owner') IS NULL;
DELETE FROM accounts WHERE user_id = 'owner' AND (SELECT email FROM users WHERE id = 'owner') IS NULL;
DELETE FROM sessions WHERE user_id = 'owner' AND (SELECT email FROM users WHERE id = 'owner') IS NULL;
DELETE FROM users WHERE id = 'owner' AND email IS NULL;
CREATE INDEX users_guests ON users(created_at) WHERE email IS NULL;
