import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = 'EUR') {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: currency,
  }).format(amount);
}

// A handful of "boolean" project columns (is_chantier, is_complete_mission…)
// are stored as TEXT in Postgres, not BOOLEAN. The API round-trips a real
// boolean on write, but Postgres stores it as the literal string "true"/
// "false" — so a plain `!!value` read is always true once anything has been
// saved (a non-empty string is truthy in JS regardless of its content).
// Route every read of one of these flags through this helper instead.
export function isFlagTrue(value: unknown): boolean {
  if (typeof value === 'string') return value === 'true' || value === '1';
  return !!value;
}
