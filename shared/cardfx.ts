// Costo del cambio stimato per carta (ricarico calcolato da una spesa con l'addebito vero).

export interface CardFx { card: string; currency: string | null; markup_bp: number | null; sample_tx_id: string | null; sample_charged: number | null; updated_at: string }

export function fxFeeEstimate(fx: CardFx | null | undefined, currency: string, amountEur: number): number | null {
  if (!fx || fx.markup_bp == null || !fx.currency || fx.currency === currency) return null;
  return Math.round((Math.abs(amountEur) * Math.max(0, fx.markup_bp)) / 10000);
}
