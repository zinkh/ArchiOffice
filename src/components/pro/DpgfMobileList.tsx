import React from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import type { Chapitre, Ligne, Lot } from '../../types/dpgf';
import { formatCurrency } from '../../lib/utils';
import { EditableCell, type EditingCell } from './EditableCell';
import { rowKey, sumLigne, type FlatRow } from './treeOps';

interface DpgfMobileListProps {
  rows: FlatRow<Lot, Chapitre, Ligne>[];
  sousTotaux: number[];
  selected: Set<string>;
  onToggleSelect: (rKey: string) => void;
  expandedLots: Set<string>;
  expandedChaps: Set<string>;
  expandedLignes: Set<string>;
  onToggleLot: (id: string) => void;
  onToggleChap: (id: string) => void;
  onToggleLigne: (id: string) => void;
  editingCell: EditingCell | null;
  onStartEdit: (rKey: string, field: string, value: string | number) => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
}

const fmtQte = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n || 0);

/**
 * Le DPGF sur téléphone : lots et chapitres en intertitres, chaque article en
 * carte. Une case coche l'article (la barre de sélection apparaît au bas de
 * l'écran), un appui sur la désignation, la quantité ou le prix les modifie.
 */
export function DpgfMobileList(props: DpgfMobileListProps) {
  const { t } = useTranslation();
  const {
    rows, sousTotaux, selected, onToggleSelect, expandedLots, expandedChaps, expandedLignes,
    onToggleLot, onToggleChap, onToggleLigne, editingCell, onStartEdit, onCommit, onCancel,
  } = props;
  const cell = { editingCell, onStartEdit, onCommit, onCancel, editOnClick: true };

  return (
    <div className="flex flex-col gap-2 p-3 pb-40">
      {rows.map(row => {
        const rKey = rowKey(row);
        if (row.kind === 'lot') {
          const open = expandedLots.has(row.lot.id);
          return (
            <button
              key={rKey}
              type="button"
              aria-expanded={open}
              onClick={() => onToggleLot(row.lot.id)}
              className="flex items-center gap-2 pt-3 pb-1 px-1 text-left min-h-11"
            >
              {open ? <IconChevronDown size={16} aria-hidden /> : <IconChevronRight size={16} aria-hidden />}
              <span className="flex-1 min-w-0 font-bold">
                <span className="font-mono font-medium mr-1.5" style={{ color: 'var(--tblr-muted)' }}>{row.lot.numero}</span>
                {row.lot.titre}
              </span>
              <span className="font-bold tabular-nums whitespace-nowrap">{formatCurrency(sousTotaux[row.lotIdx] ?? 0)}</span>
            </button>
          );
        }
        if (row.kind === 'chapitre') {
          const open = expandedChaps.has(row.chapitre!.id);
          return (
            <button
              key={rKey}
              type="button"
              aria-expanded={open}
              onClick={() => onToggleChap(row.chapitre!.id)}
              className="flex items-center gap-2 px-1 text-left text-[0.8125rem] font-semibold min-h-11"
              style={{ color: 'var(--tblr-muted)' }}
            >
              {open ? <IconChevronDown size={14} aria-hidden /> : <IconChevronRight size={14} aria-hidden />}
              <span className="font-mono font-normal">{row.chapitre!.numero}</span>
              <span className="truncate">{row.chapitre!.titre}</span>
            </button>
          );
        }
        const l = row.ligne!;
        const isSelected = selected.has(rKey);
        const hasChildren = !!l.children?.length;
        return (
          <div
            key={rKey}
            className="flex gap-3 p-3 rounded-lg border"
            style={{
              marginLeft: `${(row.depth - 2) * 0.75}rem`,
              background: isSelected ? 'var(--tblr-primary-lt)' : 'var(--tblr-surface)',
              borderColor: isSelected ? 'var(--tblr-primary)' : 'var(--tblr-border)',
            }}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(rKey)}
              aria-label={t('pro_select_row', { numero: l.numero })}
              className="mt-0.5 w-5 h-5 shrink-0 accent-[var(--tblr-primary)]"
            />
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div className="flex items-start gap-2">
                <span className="font-mono text-[0.8125rem] pt-0.5 shrink-0" style={{ color: 'var(--tblr-muted)' }}>{l.numero}</span>
                <div className="flex-1 min-w-0">
                  <EditableCell rKey={rKey} field="designation" value={l.designation} label={t('pro_col_designation')} {...cell} />
                </div>
                {l.articleTypeId && <span className="shrink-0 text-[0.6875rem] font-semibold px-1.5 rounded" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>BIB</span>}
                {l.genereParIa && <span className="shrink-0 text-[0.6875rem] font-semibold px-1.5 rounded border" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>IA</span>}
              </div>
              {hasChildren ? (
                <div className="flex items-center justify-between text-[0.8125rem]">
                  <button type="button" aria-expanded={expandedLignes.has(l.id)} onClick={() => onToggleLigne(l.id)} className="inline-flex items-center gap-1 min-h-9" style={{ color: 'var(--tblr-muted)' }}>
                    {expandedLignes.has(l.id) ? <IconChevronDown size={14} aria-hidden /> : <IconChevronRight size={14} aria-hidden />}
                    {t('pro_sub_articles', { count: l.children!.length })}
                  </button>
                  <span className="font-semibold tabular-nums">{formatCurrency(sumLigne(l))}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[0.8125rem] tabular-nums" style={{ color: 'var(--tblr-muted)' }}>
                  {l.quantitesBatiments !== undefined
                    ? <span>{fmtQte(l.quantite)}</span>
                    : <div className="w-16"><EditableCell rKey={rKey} field="quantite" value={l.quantite} numeric label={t('pro_col_quantity')} {...cell} /></div>}
                  <span>{l.unite} ×</span>
                  <div className="w-20"><EditableCell rKey={rKey} field="prixUnitaire" value={l.prixUnitaire} numeric label={t('pro_col_unit_price')} {...cell} /></div>
                  <span className="ml-auto font-semibold whitespace-nowrap" style={{ color: 'var(--tblr-text)' }}>{formatCurrency(l.prixTotal)}</span>
                </div>
              )}
              {l.localisation && <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{l.localisation}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
