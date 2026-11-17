-- Le correzioni del saldo fatte da Altro › Conti erano salvate come spese o entrate e finivano in statistiche,
-- budget e avvisi. Da ora sono "aggiustamenti" (type 'transfer', source 'adjustment'): cambiano solo il saldo.
UPDATE transactions SET type = 'transfer', source = 'adjustment', category_id = NULL, nature = NULL, status = 'confirmed', review_reason = NULL
WHERE merchant = 'Correzione saldo' AND source = 'manual' AND type IN ('expense', 'income');

-- Spese ricorrenti più flessibili: ogni N settimane, mesi o anni (es. ogni 3 mesi = period 'month', every 3).
-- last_date, per quelle aggiunte a mano, è una data di addebito attesa da cui contare.
ALTER TABLE recurring ADD COLUMN every INTEGER NOT NULL DEFAULT 1;
