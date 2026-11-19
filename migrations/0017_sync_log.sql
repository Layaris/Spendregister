-- Copia completa dei dati sul telefono: ogni modifica alle tabelle copiate lascia una riga qui (dai trigger, così
-- nessun percorso del server se la dimentica). L'app chiede "cosa è cambiato dopo il numero N" (GET /api/sync)
-- e rilegge solo quelle righe. Il cron toglie le righe vecchie; chi è rimasto indietro riscarica tutto.
CREATE TABLE sync_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  tbl TEXT NOT NULL,
  row_key TEXT NOT NULL
);
CREATE INDEX sync_log_user ON sync_log(user_id, seq);

CREATE TRIGGER sync_accounts_ins AFTER INSERT ON accounts BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'accounts', NEW.id);
END;
CREATE TRIGGER sync_accounts_upd AFTER UPDATE ON accounts BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'accounts', NEW.id);
  INSERT INTO sync_log (user_id, tbl, row_key) SELECT OLD.user_id, 'accounts', OLD.id WHERE OLD.user_id <> NEW.user_id OR OLD.id <> NEW.id;
END;
CREATE TRIGGER sync_accounts_del AFTER DELETE ON accounts BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (OLD.user_id, 'accounts', OLD.id);
END;

CREATE TRIGGER sync_categories_ins AFTER INSERT ON categories BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'categories', NEW.id);
END;
CREATE TRIGGER sync_categories_upd AFTER UPDATE ON categories BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'categories', NEW.id);
  INSERT INTO sync_log (user_id, tbl, row_key) SELECT OLD.user_id, 'categories', OLD.id WHERE OLD.user_id <> NEW.user_id OR OLD.id <> NEW.id;
END;
CREATE TRIGGER sync_categories_del AFTER DELETE ON categories BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (OLD.user_id, 'categories', OLD.id);
END;

CREATE TRIGGER sync_labels_ins AFTER INSERT ON labels BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'labels', NEW.id);
END;
CREATE TRIGGER sync_labels_upd AFTER UPDATE ON labels BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'labels', NEW.id);
  INSERT INTO sync_log (user_id, tbl, row_key) SELECT OLD.user_id, 'labels', OLD.id WHERE OLD.user_id <> NEW.user_id OR OLD.id <> NEW.id;
END;
CREATE TRIGGER sync_labels_del AFTER DELETE ON labels BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (OLD.user_id, 'labels', OLD.id);
END;

CREATE TRIGGER sync_transactions_ins AFTER INSERT ON transactions BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'transactions', NEW.id);
END;
CREATE TRIGGER sync_transactions_upd AFTER UPDATE ON transactions BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'transactions', NEW.id);
  INSERT INTO sync_log (user_id, tbl, row_key) SELECT OLD.user_id, 'transactions', OLD.id WHERE OLD.user_id <> NEW.user_id OR OLD.id <> NEW.id;
END;
CREATE TRIGGER sync_transactions_del AFTER DELETE ON transactions BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (OLD.user_id, 'transactions', OLD.id);
END;

CREATE TRIGGER sync_budgets_ins AFTER INSERT ON budgets BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'budgets', NEW.category_id);
END;
CREATE TRIGGER sync_budgets_upd AFTER UPDATE ON budgets BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'budgets', NEW.category_id);
  INSERT INTO sync_log (user_id, tbl, row_key) SELECT OLD.user_id, 'budgets', OLD.category_id WHERE OLD.user_id <> NEW.user_id OR OLD.category_id <> NEW.category_id;
END;
CREATE TRIGGER sync_budgets_del AFTER DELETE ON budgets BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (OLD.user_id, 'budgets', OLD.category_id);
END;

CREATE TRIGGER sync_recurring_ins AFTER INSERT ON recurring BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'recurring', NEW.id);
END;
CREATE TRIGGER sync_recurring_upd AFTER UPDATE ON recurring BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'recurring', NEW.id);
  INSERT INTO sync_log (user_id, tbl, row_key) SELECT OLD.user_id, 'recurring', OLD.id WHERE OLD.user_id <> NEW.user_id OR OLD.id <> NEW.id;
END;
CREATE TRIGGER sync_recurring_del AFTER DELETE ON recurring BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (OLD.user_id, 'recurring', OLD.id);
END;

CREATE TRIGGER sync_trips_ins AFTER INSERT ON trips BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'trips', NEW.id);
END;
CREATE TRIGGER sync_trips_upd AFTER UPDATE ON trips BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'trips', NEW.id);
  INSERT INTO sync_log (user_id, tbl, row_key) SELECT OLD.user_id, 'trips', OLD.id WHERE OLD.user_id <> NEW.user_id OR OLD.id <> NEW.id;
END;
CREATE TRIGGER sync_trips_del AFTER DELETE ON trips BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (OLD.user_id, 'trips', OLD.id);
END;

CREATE TRIGGER sync_trip_items_ins AFTER INSERT ON trip_items BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'trip_items', NEW.trip_id || '|' || NEW.transaction_id);
END;
CREATE TRIGGER sync_trip_items_upd AFTER UPDATE ON trip_items BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'trip_items', NEW.trip_id || '|' || NEW.transaction_id);
  INSERT INTO sync_log (user_id, tbl, row_key) SELECT OLD.user_id, 'trip_items', OLD.trip_id || '|' || OLD.transaction_id WHERE OLD.user_id <> NEW.user_id OR OLD.trip_id || '|' || OLD.transaction_id <> NEW.trip_id || '|' || NEW.transaction_id;
END;
CREATE TRIGGER sync_trip_items_del AFTER DELETE ON trip_items BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (OLD.user_id, 'trip_items', OLD.trip_id || '|' || OLD.transaction_id);
END;

CREATE TRIGGER sync_card_settings_ins AFTER INSERT ON card_settings BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'card_settings', NEW.card);
END;
CREATE TRIGGER sync_card_settings_upd AFTER UPDATE ON card_settings BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'card_settings', NEW.card);
  INSERT INTO sync_log (user_id, tbl, row_key) SELECT OLD.user_id, 'card_settings', OLD.card WHERE OLD.user_id <> NEW.user_id OR OLD.card <> NEW.card;
END;
CREATE TRIGGER sync_card_settings_del AFTER DELETE ON card_settings BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (OLD.user_id, 'card_settings', OLD.card);
END;

CREATE TRIGGER sync_merchant_aliases_ins AFTER INSERT ON merchant_aliases BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'merchant_aliases', NEW.alias);
END;
CREATE TRIGGER sync_merchant_aliases_upd AFTER UPDATE ON merchant_aliases BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.user_id, 'merchant_aliases', NEW.alias);
  INSERT INTO sync_log (user_id, tbl, row_key) SELECT OLD.user_id, 'merchant_aliases', OLD.alias WHERE OLD.user_id <> NEW.user_id OR OLD.alias <> NEW.alias;
END;
CREATE TRIGGER sync_merchant_aliases_del AFTER DELETE ON merchant_aliases BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (OLD.user_id, 'merchant_aliases', OLD.alias);
END;

CREATE TRIGGER sync_transaction_labels_ins AFTER INSERT ON transaction_labels BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) SELECT user_id, 'transaction_labels', id FROM transactions WHERE id = NEW.transaction_id;
END;
CREATE TRIGGER sync_transaction_labels_del AFTER DELETE ON transaction_labels BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) SELECT user_id, 'transaction_labels', id FROM transactions WHERE id = OLD.transaction_id;
END;
-- Impostazioni dell'account (tema, valuta, Home, funzioni): l'app le rilegge quando cambiano.
CREATE TRIGGER sync_users_upd AFTER UPDATE OF timezone, display_currency, theme, home_layout, features, hero_style, email, recovery_created_at ON users BEGIN
  INSERT INTO sync_log (user_id, tbl, row_key) VALUES (NEW.id, 'users', NEW.id);
END;
