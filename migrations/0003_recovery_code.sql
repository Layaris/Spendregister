-- Il recupero password ora usa un codice di recupero (come Multifolio), non più un link via email:
-- la tabella dei link non serve più.
DROP TABLE IF EXISTS password_resets;
