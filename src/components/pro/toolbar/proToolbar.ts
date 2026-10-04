// ── Barre d'outils des documents PRO ─────────────────────────────────────────
// Remplace le ruban (ProRibbon) : une seule ligne, celle des sous-onglets, porte
// l'état d'enregistrement, les actions du document affiché et le menu « ⋯ » du
// dossier PRO. Chaque atelier (DPGF, CCTP, Estimation, BPU/DQE) déclare ses
// actions par `useProToolbar` ; ProTab les affiche dans sa propre ligne.
//
// L'atelier garde ainsi tout son état (sélection, panneaux ouverts) sans le
// remonter dans ProTab, et ProTab ne se re-rend que lorsque l'apparence de la
// barre change (signature), pas à chaque frappe dans le tableau.
import { createContext, useContext, useLayoutEffect, useRef, type MutableRefObject, type ReactNode } from 'react';

export interface ToolbarAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Raccourci affiché à droite de l'entrée, ex. « Ctrl+D ». */
  shortcut?: string;
  danger?: boolean;
  /** Infobulle, ex. la raison pour laquelle l'entrée est grisée. */
  hint?: string;
  /** Case cochée dans un menu (panneau ouvert, option active). */
  checked?: boolean;
}

export type ToolbarMenuEntry =
  | ToolbarAction
  | { id: string; separator: true }
  | { id: string; heading: string };

interface ToolbarItemBase {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Reste visible sur téléphone ; sinon l'entrée passe dans le menu « ⋯ ». */
  mobile?: boolean;
  hint?: string;
}

export type ToolbarItem =
  | (ToolbarItemBase & {
      kind: 'button';
      onClick: () => void;
      disabled?: boolean;
      /** Action principale du document, sur fond teinté. */
      accent?: boolean;
      /** Bascule (panneau ouvert) : `aria-pressed`. */
      pressed?: boolean;
      /** Pastille : ce que le panneau configure est déjà en place. */
      badge?: boolean;
    })
  | (ToolbarItemBase & { kind: 'menu'; accent?: boolean; entries: ToolbarMenuEntry[] })
  | (ToolbarItemBase & {
      kind: 'segmented';
      value: string;
      options: { id: string; label: string; disabled?: boolean }[];
      onChange: (id: string) => void;
    });

export const isSeparator = (e: ToolbarMenuEntry): e is { id: string; separator: true } => 'separator' in e;
export const isHeading = (e: ToolbarMenuEntry): e is { id: string; heading: string } => 'heading' in e;

/**
 * Ce qui se voit de la barre, sans les fonctions ni les icônes : ProTab ne se
 * re-rend que si cette chaîne change.
 */
export function toolbarSignature(items: ToolbarItem[]): string {
  return JSON.stringify(items, (key, value) => {
    if (key === 'icon' || typeof value === 'function') return undefined;
    return value;
  });
}

/**
 * Retrouve l'action à exécuter dans la DERNIÈRE version des entrées : celle
 * affichée par ProTab peut dater d'un rendu antérieur de l'atelier, et un
 * export lancé depuis une fermeture périmée exporterait un document périmé.
 */
export function invokeToolbarAction(items: ToolbarItem[], id: string, value?: string): boolean {
  // Option d'un sélecteur dépliée dans le menu « ⋯ » (cf. foldForMobile).
  const [segmentedId, optionId] = id.split('::');
  if (optionId !== undefined && value === undefined) return invokeToolbarAction(items, segmentedId, optionId);
  for (const item of items) {
    if (item.kind === 'button' && item.id === id) {
      if (item.disabled) return false;
      item.onClick();
      return true;
    }
    if (item.kind === 'segmented' && item.id === id && value !== undefined) {
      if (item.options.find(o => o.id === value)?.disabled) return false;
      item.onChange(value);
      return true;
    }
    if (item.kind === 'menu') {
      const entry = item.entries.find(e => e.id === id);
      if (entry && !isSeparator(entry) && !isHeading(entry)) {
        if (entry.disabled) return false;
        entry.onClick();
        return true;
      }
    }
  }
  return false;
}

/**
 * Sur téléphone, seules les entrées `mobile` restent dans la ligne ; les autres
 * sont dépliées dans le menu « ⋯ », un intitulé par groupe. Les identifiants
 * sont repris tels quels pour que `invokeToolbarAction` les retrouve.
 */
export function foldForMobile(items: ToolbarItem[]): { visible: ToolbarItem[]; folded: ToolbarMenuEntry[] } {
  const visible: ToolbarItem[] = [];
  const folded: ToolbarMenuEntry[] = [];
  for (const item of items) {
    if (item.mobile) { visible.push(item); continue; }
    if (item.kind === 'button') {
      folded.push({
        id: item.id, label: item.label, icon: item.icon, onClick: item.onClick,
        disabled: item.disabled, hint: item.hint, checked: item.pressed,
      });
    } else if (item.kind === 'menu') {
      if (folded.length) folded.push({ id: `${item.id}__sep`, separator: true });
      folded.push({ id: `${item.id}__heading`, heading: item.label });
      folded.push(...item.entries.filter(e => !isHeading(e)));
    } else {
      if (folded.length) folded.push({ id: `${item.id}__sep`, separator: true });
      folded.push({ id: `${item.id}__heading`, heading: item.label });
      for (const option of item.options) {
        folded.push({
          id: `${item.id}::${option.id}`, label: option.label, disabled: option.disabled,
          checked: item.value === option.id, onClick: () => item.onChange(option.id),
        });
      }
    }
  }
  return { visible, folded };
}

// ── Registre ─────────────────────────────────────────────────────────────────

export interface ToolbarRegistration {
  source: MutableRefObject<ToolbarItem[]>;
  signature: string;
}

export interface ToolbarRegistry {
  register: (registration: ToolbarRegistration | null) => void;
}

export const ProToolbarContext = createContext<ToolbarRegistry | null>(null);

/** Déclare les actions du document affiché dans la barre de ProTab. */
export function useProToolbar(items: ToolbarItem[]): void {
  const registry = useContext(ProToolbarContext);
  const source = useRef(items);
  useLayoutEffect(() => { source.current = items; });
  const signature = toolbarSignature(items);
  useLayoutEffect(() => { registry?.register({ source, signature }); }, [registry, signature]);
  useLayoutEffect(() => () => registry?.register(null), [registry]);
}
