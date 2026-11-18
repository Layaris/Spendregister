// Icone dell'app: set Lucide (licenza ISC), tutte con lo stesso tratto. I nomi restano quelli salvati nel database
// (categorie: food, home, car…) e usati nelle pagine; qui si traducono nell'icona Lucide giusta.
import {
  ArrowLeftRight, ArrowUpDown, BadgeCheck, CalendarDays, ChartColumnIncreasing, Coins, HandCoins, Leaf, PiggyBank, User, Banknote, Bell, Bike, BookOpen, Briefcase, Calendar, Camera, Car, ChartColumn, ChartPie, Check,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Copy, CreditCard, Download, Ellipsis, Eye, Gift, HandHeart, House, Inbox,
  Landmark, List, Mic, NotebookPen, PawPrint, Plane, Plus, Repeat, Settings, ShoppingBag, SlidersHorizontal, Smartphone, Sparkles,
  Star, Stethoscope, Store, Tag, Ticket, Trash2, TrendingUp, TriangleAlert, Users, UtensilsCrossed, Wallet, WifiOff, X, Zap,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  back: ChevronLeft, next: ChevronRight, down: ChevronDown, close: X, plus: Plus,
  home: House, list: List, chart: ChartColumn, stats: ChartPie, more: Ellipsis, dots: Ellipsis,
  eye: Eye, sparkle: Sparkles, bolt: Zap, check: Check, verified: BadgeCheck, camera: Camera, phone: Smartphone,
  download: Download, mic: Mic, rules: SlidersHorizontal, gear: Settings, inbox: Inbox, trash: Trash2, copy: Copy,
  warn: TriangleAlert, bell: Bell, offline: WifiOff, cash: Banknote,
  coins: Coins, leaf: Leaf, user: User, inout: ArrowUpDown, moneybag: HandCoins, growth: ChartColumnIncreasing, days: CalendarDays, piggy: PiggyBank,
  // Categorie
  food: UtensilsCrossed, bag: ShoppingBag, car: Car, scooter: Bike, heart: HandHeart, bank: Landmark, income: TrendingUp,
  transfer: ArrowLeftRight, question: CircleHelp, repeat: Repeat, health: Stethoscope, ticket: Ticket, plane: Plane,
  book: BookOpen, briefcase: Briefcase, family: Users, gift: Gift, paw: PawPrint, wallet: Wallet, calendar: Calendar,
  note: NotebookPen, store: Store, card: CreditCard, tag: Tag, star: Star,
};

export const ICON_NAMES = Object.keys(ICONS);

export function Icon({ name, size = 22, stroke = 1.9, label }: { name: string; size?: number; stroke?: number; label?: string }) {
  const C = ICONS[name] ?? Ellipsis;
  return <C size={size} strokeWidth={stroke} absoluteStrokeWidth={false} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label} />;
}
