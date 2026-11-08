import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '../ui/ModalShell';
import { calculerSaisie } from '../../lib/quantites';
import { formatQuantite } from '../../lib/quantiteFormat';
import {
  candidatsSources, COEFFICIENT_MAX, coefficientDe, delierPatch, lierPatch, ligneParId, peutSuivre,
} from '../../lib/quantitesLiees';
import type { Ligne } from '../../types/dpgf';
import type { LotLike } from './treeOps';

interface LienQuantiteDialogProps {
  /** L'article qui doit suivre la quantité d'un autre. */
  ligne: Ligne;
  /** Tous les lots du document : la source peut être dans n'importe lequel. */
  lots: LotLike[];
  /** Reçoit le correctif à fusionner dans l'article (lien posé ou retiré). */
  onSave: (patch: Partial<Ligne>) => void;
  onClose: () => void;
}

/** Postes affichés d'un coup : au-delà, on invite à préciser la recherche. */
const MAX_AFFICHES = 50;

const sansAccent = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const texteCoefficient = (c: number) => String(c).replace('.', ',');

/**
 * Fait suivre à un article la quantité d'un autre poste (menuiserie et volets roulants, doublage et peinture) :
 * choix de la source dans une liste filtrable, coefficient, quantité obtenue. « Détacher » rend la saisie de la
 * quantité en gardant la valeur actuelle. Les refus (boucle, source parent...) viennent de `peutSuivre`, le même
 * contrôle que celui des écrans qui enregistrent.
 */
export function LienQuantiteDialog({ ligne, lots, onSave, onClose }: LienQuantiteDialogProps) {
  const { t } = useTranslation();
  const lienActuel = ligne.quantiteLiee;
  const [recherche, setRecherche] = useState('');
  const [choisi, setChoisi] = useState<string | null>(lienActuel?.sourceId ?? null);
  const [coefficientSaisi, setCoefficientSaisi] = useState(texteCoefficient(coefficientDe(lienActuel)));
  const [refus, setRefus] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => { champ.current?.focus(); }, []);

  const candidats = useMemo(() => candidatsSources(lots, ligne.id), [lots, ligne.id]);
  const filtres = useMemo(() => {
    const mots = sansAccent(recherche).split(/\s+/).filter(Boolean);
    return candidats.filter(c => {
      const texte = sansAccent(`${c.numero} ${c.designation} ${c.lotNumero} ${c.lotTitre}`);
      return mots.every(m => texte.includes(m));
    });
  }, [candidats, recherche]);

  const source = choisi ? ligneParId(lots, choisi) : undefined;
  const sourceActuelle = lienActuel ? ligneParId(lots, lienActuel.sourceId) : undefined;
  const calcul = calculerSaisie(coefficientSaisi);
  const coefficient = calcul.ok && calcul.valeur > 0 && calcul.valeur <= COEFFICIENT_MAX ? calcul.valeur : null;
  const apercu = source && coefficient !== null ? lierPatch(ligne, source, coefficient) : null;
  const unitesDifferentes = !!source && source.unite.trim() !== '' && ligne.unite.trim() !== '' && source.unite.trim() !== ligne.unite.trim();
  const inchange = !!lienActuel && lienActuel.sourceId === choisi && coefficient === coefficientDe(lienActuel);

  const enregistrer = () => {
    if (!source || coefficient === null) return;
    if (!peutSuivre(lots, ligne.id, source.id).ok) { setRefus(true); return; }
    const patch = lierPatch(ligne, source, coefficient);
    if (!patch) return;
    onSave(patch);
    onClose();
  };
  const detacher = () => { onSave(delierPatch()); onClose(); };

  return (
    <AnimatePresence>
      <ModalShell
        key="lien-quantite"
        title={t('pro_link_title', { numero: ligne.numero })}
        subtitle={ligne.designation}
        onClose={onClose}
        dirty={!inchange && choisi !== null && choisi !== (lienActuel?.sourceId ?? null)}
        size="lg"
        bodyClassName="p-4 sm:p-6"
        footer={(
          <div className="flex items-center justify-between gap-3 w-full">
            {lienActuel ? (
              <button type="button" className="btn" onClick={detacher}>{t('pro_link_detach')}</button>
            ) : <span />}
            <div className="flex gap-2 ml-auto">
              <button type="button" className="btn" onClick={onClose}>{t('pro_undo')}</button>
              <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={!source || coefficient === null || inchange}>
                {t('pro_link_apply')}
              </button>
            </div>
          </div>
        )}
      >
        <p className="text-xs mb-3" style={{ color: 'var(--tblr-muted)' }}>{t('pro_link_hint')}</p>
        {lienActuel && (
          <p className="text-sm mb-3">
            {sourceActuelle
              ? t('pro_link_current', { numero: sourceActuelle.numero, designation: sourceActuelle.designation })
              : t('pro_link_source_missing')}
          </p>
        )}

        <label htmlFor="lien-quantite-recherche" className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('pro_link_search')}</label>
        <input
          id="lien-quantite-recherche"
          ref={champ}
          type="search"
          autoComplete="off"
          value={recherche}
          onChange={e => setRecherche(e.target.value)}
          placeholder={t('pro_link_search_placeholder')}
          className="w-full mb-2 px-3 py-2 text-sm rounded border outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]"
          style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
        />
        <div
          role="radiogroup"
          aria-label={t('pro_link_search')}
          className="max-h-64 overflow-auto rounded border"
          style={{ borderColor: 'var(--tblr-border)' }}
        >
          {filtres.length === 0 && (
            <p className="px-3 py-3 text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('pro_link_none')}</p>
          )}
          {filtres.slice(0, MAX_AFFICHES).map(c => {
            const actif = c.id === choisi;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={actif}
                onClick={() => { setChoisi(c.id); setRefus(false); }}
                className="w-full flex items-baseline gap-2 px-3 py-2 text-left text-sm border-b last:border-b-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--tblr-primary)] pointer-coarse:min-h-11"
                style={{ borderColor: 'var(--tblr-border)', background: actif ? 'var(--tblr-surface-2)' : 'transparent', fontWeight: actif ? 700 : 400 }}
              >
                <span className="shrink-0 font-mono text-xs" style={{ color: 'var(--tblr-muted)' }}>{c.numero}</span>
                <span className="min-w-0 flex-1 truncate">{c.designation}</span>
                <span className="shrink-0 text-xs" style={{ color: 'var(--tblr-muted)' }}>{c.lotNumero ? `${t('pro_link_lot')} ${c.lotNumero}` : ''}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums">{formatQuantite(c.quantite)} {c.unite}</span>
              </button>
            );
          })}
          {filtres.length > MAX_AFFICHES && (
            <p className="px-3 py-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('pro_link_refine', { count: filtres.length - MAX_AFFICHES })}</p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="lien-quantite-coefficient" className="text-xs font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('pro_link_coefficient')}</label>
            <input
              id="lien-quantite-coefficient"
              type="text"
              inputMode="decimal"
              value={coefficientSaisi}
              onChange={e => setCoefficientSaisi(e.target.value)}
              aria-invalid={coefficient === null || undefined}
              className="w-28 px-2 py-1.5 text-sm text-right font-mono tabular-nums rounded border outline-none focus:ring-2 focus:ring-[var(--tblr-primary)] pointer-coarse:h-11"
              style={{ borderColor: coefficient === null ? '#b91c1c' : 'var(--tblr-border)', background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
            />
          </div>
          <p className="flex-1 min-w-[12rem] text-xs pt-5" style={{ color: 'var(--tblr-muted)' }}>{t('pro_link_coefficient_hint')}</p>
        </div>
        {coefficient === null && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">{t('pro_link_coefficient_invalid')}</p>}

        {apercu && (
          <p className="mt-3 text-sm font-semibold">
            {t('pro_link_result', { quantite: formatQuantite(apercu.quantite ?? 0), unite: ligne.unite })}
          </p>
        )}
        {unitesDifferentes && source && (
          <p role="status" className="mt-1 text-xs" style={{ color: 'var(--tblr-muted)' }}>
            {t('pro_link_unit_mismatch', { source: source.unite, unite: ligne.unite })}
          </p>
        )}
        {refus && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">{t('pro_link_refused')}</p>}
      </ModalShell>
    </AnimatePresence>
  );
}
