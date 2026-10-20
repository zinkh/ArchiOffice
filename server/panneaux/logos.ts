// Validation des logos intégrés à un panneau. Un logo vient de la fiche contact
// (data URL enregistrée par ContactLogoField) : il est relu côté serveur et
// jamais pris dans la requête du client.
import { Jimp } from 'jimp';
import { sniffImageMime } from '../imageUpload';
import type { PanelLogo } from './types';

const MAX_LOGO_BYTES = 1.5 * 1024 * 1024;
// Pas de SVG : il peut embarquer des scripts ou des références externes.
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type LogoResult = { logo: PanelLogo } | { logo: null; reason: string };

export async function prepareLogo(raw: unknown): Promise<LogoResult> {
  if (typeof raw !== 'string' || raw.trim() === '') return { logo: null, reason: 'absent' };
  const match = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(raw.trim());
  if (!match) return { logo: null, reason: 'format de logo non pris en charge' };
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) return { logo: null, reason: 'logo trop volumineux ou vide' };
  // Le type annoncé ne compte pas : on lit les octets.
  const mime = sniffImageMime(bytes);
  if (!mime || !ALLOWED.has(mime)) return { logo: null, reason: 'type d’image refusé (PNG, JPEG ou WebP uniquement)' };
  let widthPx: number | null = null;
  let heightPx: number | null = null;
  try {
    const image = await Jimp.read(bytes);
    widthPx = image.bitmap.width;
    heightPx = image.bitmap.height;
  } catch { /* WebP sans décodeur : le logo reste intégré, sans mesure de définition */ }
  return { logo: { dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, widthPx, heightPx } };
}

/** Définition (dpi) d'un logo affiché à `heightMm` de haut : en dessous de 100, l'impression sera floue. */
export function logoDpi(logo: PanelLogo, heightMm: number): number | null {
  if (!logo.heightPx || heightMm <= 0) return null;
  return Math.round(logo.heightPx / (heightMm / 25.4));
}
