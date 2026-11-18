import { useId } from 'react';
/** Sagome vettoriali ricostruite dalla tavola: nessuna modifica alla mappa Lucide. */
export function BrandMark() {
  const id = useId();
  return <svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id={id} x2=".85" y2="1"><stop stopColor="var(--brand-light)"/><stop offset=".55" stopColor="var(--brand-mid)"/><stop offset="1" stopColor="var(--brand-dark)"/></linearGradient></defs><rect x="1" y="1" width="62" height="62" rx="18" fill={`url(#${id})`}/><path d="M13 48C16 26 27 17 51 13C47 35 36 46 13 48Z" fill="#f3fcff"/><path d="M13 48C24 34 37 23 51 13C39 34 26 44 13 48Z" fill="#cce8ed" opacity=".65"/></svg>;
}
export function BudgetWallet() {
  const id = useId();
  return <svg className="budget-wallet" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id={id} x2="1" y2="1"><stop stopColor="var(--wallet-light)"/><stop offset="1" stopColor="var(--wallet-dark)"/></linearGradient></defs><path d="M5 10L23 4L26 13" fill="none" stroke="var(--wallet-dark)" strokeWidth="2.4" strokeLinejoin="round"/><path d="M6 10H25V14H5Z" fill="var(--wallet-paper)"/><rect x="3" y="11" width="26" height="18" rx="3.5" fill={`url(#${id})`}/><path d="M24 18H30V25H24C20 25 20 18 24 18Z" fill="var(--wallet-dark)"/><circle cx="25" cy="21.5" r="1.4" fill="#fff"/></svg>;
}
