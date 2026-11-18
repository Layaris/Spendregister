-- Versione del comando iPhone installato su ogni telefono (dal campo "v" che manda il comando, "1" per quello vecchio):
-- l'app avvisa quando c'è da riscaricarlo.
ALTER TABLE devices ADD COLUMN client_version TEXT;
