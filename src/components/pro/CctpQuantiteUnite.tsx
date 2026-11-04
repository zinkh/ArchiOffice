import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatQuantite } from '../../lib/quantiteFormat';

interface CctpQuantiteUniteProps {
  quantite: number;
  unite: string;
  /** Prix unitaire, montant et « pour mémoire » : le prix se saisit ici comme dans le DPGF. */
  prixUnitaire: number;
  montant: number;
  pourMemoire?: boolean;
  /** Faux pour un article réservé au CCTP (absent du DPGF) : il n'a pas de prix. */
  prixVisible: boolean;
  /** Formule mémorisée de la quantité (« =10+20 »), réaffichée à la modification. */
  formule?: string;
  /** Nombre de lignes du métré de l'article ; la quantité en est alors la somme et ne se saisit plus ici. */
  lignesMetre?: number;
  /** Quantité répartie par bâtiment : la quantité totale en est la somme, elle se modifie dans le DPGF. */
  parBatiment?: boolean;
  /** Article portant des sous-articles : pas de quantité propre. */
  aDesEnfants?: boolean;
  /** Unités déjà utilisées dans le document, proposées en tête. */
  unitesConnues: string[];
  /** Saisie brute (nombre ou « =calcul »). Rend faux si elle est refusée : la saisie reste, avec une erreur. */
  onQuantite: (saisie: string) => boolean;
  onUnite: (valeur: string) => void;
  /** Saisie brute du prix (nombre, calcul ou « PM »). Rend faux si elle est refusée. */
  onPrix: (saisie: string) => boolean;
  onDetailler: () => void;
}

const UNITES_USUELLES = ['m²', 'ml', 'm³', 'u', 'ens', 'forfait', 'kg', 'h'];
const CHAMP = 'px-2 py-1 text-sm border rounded outline-none focus:ring-2 focus:ring-[var(--tblr-primary)] bg-transparent';
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

const texteNombre = (n: number) => (n ? String(n).replace('.', ',') : '');

/**
 * Quantité, unité et prix d'un article, modifiables depuis la fiche du CCTP. La quantité et le prix
 * acceptent un calcul (« =12*3,5 ») comme dans le DPGF ; le calcul de la quantité est mémorisé et
 * réaffiché quand on la modifie. « Détailler le métré » ouvre une liste de lignes libellées dont la
 * somme est la quantité. Enregistré en quittant le champ ou par Entrée, Échap annule la frappe.
 * À monter avec `key={ligne.id}` pour repartir d'un brouillon propre à chaque article.
 */
export function CctpQuantiteUnite({
  quantite, unite, prixUnitaire, montant, pourMemoire, prixVisible, formule, lignesMetre, parBatiment, aDesEnfants,
  unitesConnues, onQuantite, onUnite, onPrix, onDetailler,
}: CctpQuantiteUniteProps) {
  const { t } = useTranslation();
  const [qDraft, setQDraft] = useState<string | null>(null);
  const [pDraft, setPDraft] = useState<string | null>(null);
  const [uDraft, setUDraft] = useState<string | null>(null);
  const [erreur, setErreur] = useState<'quantite' | 'prix' | null>(null);
  // Échap annule puis retire le focus : sans ce drapeau, la perte de focus validerait l'ancien brouillon.
  const annulation = useRef(false);
  const unites = [...new Set([...unitesConnues, ...UNITES_USUELLES])];

  if (aDesEnfants) {
    return <p className="mt-3 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_quantity_parent')}</p>;
  }

  const aMetre = !!lignesMetre;
  const texteQuantite = formule ?? texteNombre(quantite);
  const textePrix = pourMemoire ? 'PM' : texteNombre(prixUnitaire);

  const valider = (champ: 'quantite' | 'prix') => {
    if (annulation.current) { annulation.current = false; return; }
    const draft = champ === 'quantite' ? qDraft : pDraft;
    if (draft === null) return;
    const base = champ === 'quantite' ? texteQuantite : textePrix;
    const fermer = () => { champ === 'quantite' ? setQDraft(null) : setPDraft(null); setErreur(null); };
    if (draft.trim() === base.trim()) { fermer(); return; }
    const accepte = champ === 'quantite' ? onQuantite(draft) : onPrix(draft);
    if (accepte) fermer(); else setErreur(champ);
  };
  const annuler = (champ: 'quantite' | 'prix') => { annulation.current = true; champ === 'quantite' ? setQDraft(null) : setPDraft(null); setErreur(null); };
  const validerUnite = () => {
    if (annulation.current) { annulation.current = false; return; }
    if (uDraft === null) return;
    const valeur = uDraft.trim();
    if (valeur !== unite) onUnite(valeur);
    setUDraft(null);
  };
  const surTouche = (valider_: () => void, annuler_: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); valider_(); annulation.current = true; (e.target as HTMLInputElement).blur(); }
    else if (e.key === 'Escape') { e.stopPropagation(); annuler_(); (e.target as HTMLInputElement).blur(); }
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="cctp-quantite" className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_quantity')}</label>
          {parBatiment || aMetre ? (
            <span id="cctp-quantite" className="px-2 py-1 text-sm font-mono tabular-nums text-right w-28" title={parBatiment ? t('pro_cctp_quantity_by_building') : undefined}>{formatQuantite(quantite)}</span>
          ) : (
            <input
              id="cctp-quantite"
              type="text"
              inputMode="decimal"
              value={qDraft ?? texteNombre(quantite)}
              placeholder="0"
              title={formule ? t('pro_metre_formula_hint', { formule }) : undefined}
              aria-invalid={erreur === 'quantite' || undefined}
              onFocus={() => { if (formule && qDraft === null) setQDraft(formule); }}
              onChange={e => setQDraft(e.target.value)}
              onBlur={() => valider('quantite')}
              onKeyDown={surTouche(() => valider('quantite'), () => annuler('quantite'))}
              className={`${CHAMP} w-28 text-right font-mono tabular-nums pointer-coarse:h-11`}
              style={{ borderColor: erreur === 'quantite' ? '#b91c1c' : 'var(--tblr-border)' }}
            />
          )}
          {aMetre && <span className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('pro_metre_sum_of', { count: lignesMetre })}</span>}
          {!parBatiment && (
            <button
              type="button" onClick={onDetailler}
              className="self-start px-2.5 py-1 text-xs font-bold rounded-md border pointer-coarse:h-11"
              style={{ borderColor: 'var(--tblr-text)' }}
            >
              {t('pro_metre_detail')}
            </button>
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
            onKeyDown={surTouche(validerUnite, () => { annulation.current = true; setUDraft(null); })}
            className={`${CHAMP} w-24 pointer-coarse:h-11`}
            style={{ borderColor: 'var(--tblr-border)' }}
          />
          <datalist id="cctp-unites">
            {unites.map(u => <option key={u} value={u} />)}
          </datalist>
        </div>

        {prixVisible && (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor="cctp-prix" className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_unit_price')}</label>
              <input
                id="cctp-prix"
                type="text"
                inputMode="decimal"
                value={pDraft ?? (pourMemoire ? 'PM' : prixUnitaire ? euro.format(prixUnitaire) : '')}
                placeholder="0"
                aria-invalid={erreur === 'prix' || undefined}
                onFocus={() => { if (pDraft === null) setPDraft(textePrix); }}
                onChange={e => setPDraft(e.target.value)}
                onBlur={() => valider('prix')}
                onKeyDown={surTouche(() => valider('prix'), () => annuler('prix'))}
                className={`${CHAMP} w-32 text-right font-mono tabular-nums pointer-coarse:h-11`}
                style={{ borderColor: erreur === 'prix' ? '#b91c1c' : 'var(--tblr-border)' }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_amount')}</span>
              <span className="px-2 py-1 text-sm font-bold font-mono tabular-nums text-right w-32 border rounded" style={{ borderColor: 'var(--tblr-border)' }}>
                {pourMemoire ? 'PM' : euro.format(montant)}
              </span>
            </div>
          </>
        )}
      </div>
      {erreur && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{t('pro_metre_error_line')}</p>}
    </div>
  );
}
