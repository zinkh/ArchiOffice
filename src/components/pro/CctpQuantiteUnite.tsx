import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatQuantite } from '../../lib/quantiteFormat';
import { evalFormula } from './treeOps';

interface CctpQuantiteUniteProps {
  quantite: number;
  unite: string;
  /** Quantité répartie par bâtiment : la quantité totale en est la somme, elle se modifie dans le DPGF. */
  parBatiment?: boolean;
  /** Article portant des sous-articles : pas de quantité propre. */
  aDesEnfants?: boolean;
  /** Unités déjà utilisées dans le document, proposées en tête. */
  unitesConnues: string[];
  onQuantite: (valeur: number) => void;
  onUnite: (valeur: string) => void;
}

const UNITES_USUELLES = ['m²', 'ml', 'm³', 'u', 'ens', 'forfait', 'kg', 'h'];
const CHAMP = 'px-2 py-1 text-sm border rounded outline-none focus:ring-2 focus:ring-[var(--tblr-primary)] bg-transparent';

/**
 * Quantité et unité d'un article, modifiables depuis la fiche du CCTP. La
 * quantité accepte un calcul (« =12*3,5 ») comme dans le DPGF ; elle est
 * enregistrée en quittant le champ ou par Entrée, Échap annule la frappe.
 * À monter avec `key={ligne.id}` pour repartir d'un brouillon propre à chaque article.
 */
export function CctpQuantiteUnite({ quantite, unite, parBatiment, aDesEnfants, unitesConnues, onQuantite, onUnite }: CctpQuantiteUniteProps) {
  const { t } = useTranslation();
  const [qDraft, setQDraft] = useState<string | null>(null);
  const [uDraft, setUDraft] = useState<string | null>(null);
  const unites = [...new Set([...unitesConnues, ...UNITES_USUELLES])];

  if (aDesEnfants) {
    return <p className="mt-3 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_quantity_parent')}</p>;
  }

  const validerQuantite = () => {
    if (qDraft === null) return;
    const valeur = evalFormula(qDraft);
    if (valeur !== quantite) onQuantite(valeur);
    setQDraft(null);
  };
  const validerUnite = () => {
    if (uDraft === null) return;
    const valeur = uDraft.trim();
    if (valeur !== unite) onUnite(valeur);
    setUDraft(null);
  };
  const surTouche = (valider: () => void, annuler: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); valider(); (e.target as HTMLInputElement).blur(); }
    else if (e.key === 'Escape') { e.stopPropagation(); annuler(); (e.target as HTMLInputElement).blur(); }
  };

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="cctp-quantite" className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_quantity')}</label>
        {parBatiment ? (
          <span id="cctp-quantite" className="px-2 py-1 text-sm font-mono tabular-nums" title={t('pro_cctp_quantity_by_building')}>{formatQuantite(quantite)}</span>
        ) : (
          <input
            id="cctp-quantite"
            type="text"
            inputMode="decimal"
            value={qDraft ?? (quantite ? String(quantite).replace('.', ',') : '')}
            placeholder="0"
            onChange={e => setQDraft(e.target.value)}
            onBlur={validerQuantite}
            onKeyDown={surTouche(validerQuantite, () => setQDraft(null))}
            className={`${CHAMP} w-28 text-right font-mono tabular-nums pointer-coarse:h-11`}
            style={{ borderColor: 'var(--tblr-border)' }}
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="cctp-unite" className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_unit')}</label>
        <input
          id="cctp-unite"
          type="text"
          list="cctp-unites"
          autoComplete="off"
          value={uDraft ?? unite}
          onChange={e => setUDraft(e.target.value)}
          onBlur={validerUnite}
          onKeyDown={surTouche(validerUnite, () => setUDraft(null))}
          className={`${CHAMP} w-24 pointer-coarse:h-11`}
          style={{ borderColor: 'var(--tblr-border)' }}
        />
        <datalist id="cctp-unites">
          {unites.map(u => <option key={u} value={u} />)}
        </datalist>
      </div>
    </div>
  );
}
