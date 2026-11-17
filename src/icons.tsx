// Icone a tratto, tutte nello stesso stile del mockup.
const PATHS: Record<string, string> = {
  back: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z',
  bolt: 'M13 3L5 13h6l-1 8 8-10h-6l1-8z',
  check: 'M5 12l5 5 9-10',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  phone: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  rules: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-1-3-2 .3-1.5-1.5.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L6.6 7.3l-2-.3-1 3 2 1v2l-2 1 1 3 2-.3 1.5 1.5-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.5-1.5 2 .3 1-3-2-1z',
  inbox: 'M4 13l3-8h10l3 8v6H4zM4 13h5l1 2h4l1-2h5',
  trash: 'M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  warn: 'M12 4l9 16H3L12 4zM12 10v4M12 17h.01',
  food: 'M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 1-3 4-3 8h3v10',
  bag: 'M5 8h14l-1 12H6L5 8zM9 8V6a3 3 0 0 1 6 0v2',
  car: 'M5 16v-5l2-5h10l2 5v5M5 16h14M6 16v3M18 16v3M5 11h14',
  scooter: 'M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 16h6l3-8h2M14 8h3',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  bank: 'M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18',
  income: 'M12 20V6M6 12l6-6 6 6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  transfer: 'M4 8h14l-3-3M20 16H6l3 3',
  question: 'M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V14M12 18h.01',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  health: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  ticket: 'M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3zM14 4v12',
  plane: 'M3 13l7-2 4-7 2 1-2 6 5-1 2 2-6 3-5 6-2-1 2-5-5 1z',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7',
  briefcase: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  family: 'M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM16 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3 20v-4a5 5 0 0 1 10 0v4M13 20v-3a3 3 0 0 1 6 0v3',
  gift: 'M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-1-3-5-4-5-1 0 1 1 1 5 1zM12 7c1-3 5-4 5-1 0 1-1 1-5 1z',
  paw: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM16 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 14a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 5 14zM19 14a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM12 12c-3 0-5 3.5-5 5.5S9 20 12 20s5-.5 5-2.5S15 12 12 12z',
  wallet: 'M4 7a2 2 0 0 1 2-2h12v4M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2zM16 14h.01',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  note: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5',
  store: 'M4 9l1.5-5h13L20 9M4 9h16v11H4zM4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 20v-5h4v5',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8h.01',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
};

export function Icon({ name, size = 22, stroke = 1.8, label }: { name: string; size?: number; stroke?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <path d={PATHS[name] ?? PATHS.dots} />
    </svg>
  );
}
