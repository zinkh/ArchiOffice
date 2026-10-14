import React, { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IconSearch, IconX } from '@tabler/icons-react';
import { cn } from '../../../lib/utils';
import {
  rechercherDansDocument, surligner, termesDe,
  type OptionsRecherche, type Trouvaille,
} from '../../../lib/proRecherche';
import { toolbarButtonClass } from './ProToolbar';

type Document = Parameters<typeof rechercherDansDocument>[0];

interface ProSearchProps {
  /** Document affiché : DPGF pour CCTP, DPGF et estimation, bordereau pour BPU et DQE. */
  doc: Document;
  /** Le CCTP cherche aussi dans les textes techniques. */
  cctp?: boolean;
  onPick: (trouvaille: Trouvaille) => void;
}

const LARGEUR = 560;
const MARGE = 8;
const MIN_CARACTERES = 2;
const MAX = 60;

/** Texte dont les mots cherchés sont mis en valeur. */
function Surligne({ texte, termes }: { texte: string; termes: string[] }) {
  return (
    <>
      {surligner(texte, termes).map((m, i) => m.trouve
        ? <mark key={i} className="rounded-[2px] px-px" style={{ background: 'var(--tblr-primary-lt)', color: 'inherit' }}>{m.texte}</mark>
        : <React.Fragment key={i}>{m.texte}</React.Fragment>)}
    </>
  );
}

/**
 * Bouton loupe de la barre des documents PRO : ouvre une fenêtre de recherche
 * (champ + liste des trouvailles) dans le document affiché. Choisir une
 * trouvaille la fait ouvrir, sélectionner et montrer par l'atelier ouvert.
 * Motif ARIA « combobox » : le focus reste dans le champ, flèches et Entrée
 * parcourent la liste, Échap referme.
 */
export function ProSearch({ doc, cctp = false, onPick }: ProSearchProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [requete, setRequete] = useState('');
  const [actif, setActif] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const declencheur = useRef<HTMLButtonElement>(null);
  const panneau = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const liste = useRef<HTMLUListElement>(null);
  const id = useId();

  const demande = useDeferredValue(requete);
  const termes = useMemo(() => termesDe(demande), [demande]);
  const assez = demande.trim().length >= MIN_CARACTERES;
  const options: OptionsRecherche = { cctp, max: MAX };
  const trouvailles = useMemo(
    () => (assez ? rechercherDansDocument(doc, demande, options) : []),
    // `options` se déduit de `cctp`
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, demande, assez, cctp],
  );

  const fermer = (rendreLeFocus: boolean) => {
    setOpen(false);
    if (rendreLeFocus) declencheur.current?.focus();
  };

  const choisir = (trouvaille: Trouvaille) => {
    fermer(false);
    onPick(trouvaille);
  };

  useLayoutEffect(() => {
    if (!open || !declencheur.current) return;
    const r = declencheur.current.getBoundingClientRect();
    const largeur = Math.min(LARGEUR, window.innerWidth - 2 * MARGE);
    const left = Math.max(MARGE, Math.min(r.right - largeur, window.innerWidth - largeur - MARGE));
    setPos({ top: r.bottom + 4, left, width: largeur });
  }, [open]);

  useEffect(() => {
    if (open && pos) champ.current?.focus();
  }, [open, pos]);

  useEffect(() => { setActif(0); }, [demande]);

  // Garde la ligne active visible quand on parcourt la liste aux flèches.
  useEffect(() => {
    liste.current?.querySelector<HTMLElement>(`[data-index="${actif}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [actif]);

  useEffect(() => {
    if (!open) return;
    const dehors = (e: PointerEvent) => {
      const cible = e.target as Node;
      if (panneau.current?.contains(cible) || declencheur.current?.contains(cible)) return;
      setOpen(false);
    };
    const redim = () => setOpen(false);
    document.addEventListener('pointerdown', dehors, true);
    window.addEventListener('resize', redim);
    return () => {
      document.removeEventListener('pointerdown', dehors, true);
      window.removeEventListener('resize', redim);
    };
  }, [open]);

  const touches = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(true); return; }
    if (!trouvailles.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActif(a => (a + 1) % trouvailles.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActif(a => (a - 1 + trouvailles.length) % trouvailles.length); }
    else if (e.key === 'Home') { e.preventDefault(); setActif(0); }
    else if (e.key === 'End') { e.preventDefault(); setActif(trouvailles.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const choix = trouvailles[actif]; if (choix) choisir(choix); }
  };

  const idListe = `${id}-liste`;
  const idOption = (i: number) => `${id}-option-${i}`;
  const etat = !assez
    ? t('pro_search_hint')
    : trouvailles.length === 0
      ? t('pro_search_none', { query: demande.trim() })
      : trouvailles.length >= MAX
        ? t('pro_search_more', { count: MAX })
        : t('pro_search_count', { count: trouvailles.length });

  return (
    <>
      <button
        ref={declencheur}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('pro_search')}
        title={t('pro_search')}
        onClick={() => setOpen(v => !v)}
        className={toolbarButtonClass({ iconOnly: true, pressed: open })}
      >
        <IconSearch size={16} aria-hidden />
      </button>
      {open && pos && createPortal(
        <div
          ref={panneau}
          role="dialog"
          aria-label={t('pro_search')}
          onKeyDown={touches}
          className="fixed z-[60] rounded-lg border overflow-hidden flex flex-col"
          style={{
            top: pos.top, left: pos.left, width: pos.width, maxHeight: `min(75dvh, calc(100dvh - ${pos.top + MARGE}px))`,
            background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)',
            boxShadow: '0 8px 24px rgba(29,39,59,.16)',
          }}
        >
          <div className="flex items-center gap-2 px-3 border-b shrink-0" style={{ borderColor: 'var(--tblr-border)' }}>
            <IconSearch size={16} aria-hidden style={{ color: 'var(--tblr-muted)' }} className="shrink-0" />
            <input
              ref={champ}
              type="text"
              role="combobox"
              aria-expanded={trouvailles.length > 0}
              aria-controls={idListe}
              aria-activedescendant={trouvailles.length ? idOption(actif) : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              value={requete}
              onChange={e => setRequete(e.target.value)}
              placeholder={cctp ? t('pro_search_placeholder_cctp') : t('pro_search_placeholder')}
              aria-label={t('pro_search')}
              className="flex-1 min-w-0 h-11 bg-transparent outline-none text-sm"
            />
            {requete && (
              <button
                type="button"
                onClick={() => { setRequete(''); champ.current?.focus(); }}
                aria-label={t('pro_search_clear')}
                className="w-7 h-7 pointer-coarse:w-11 pointer-coarse:h-11 inline-flex items-center justify-center rounded hover:bg-[var(--tblr-surface-2)]"
                style={{ color: 'var(--tblr-muted)' }}
              >
                <IconX size={14} aria-hidden />
              </button>
            )}
          </div>
          <p role="status" className="px-3 py-1.5 text-xs shrink-0" style={{ color: 'var(--tblr-muted)' }}>{etat}</p>
          {trouvailles.length > 0 && (
            <ul
              ref={liste}
              id={idListe}
              role="listbox"
              aria-label={t('pro_search_results')}
              className="overflow-y-auto border-t py-1"
              style={{ borderColor: 'var(--tblr-border)' }}
            >
              {trouvailles.map((r, i) => (
                <li
                  key={`${r.kind}-${r.id}`}
                  id={idOption(i)}
                  role="option"
                  data-index={i}
                  aria-selected={i === actif}
                  // mousedown : le champ garde le focus, la liste ne se referme pas avant le choix.
                  onMouseDown={e => { e.preventDefault(); choisir(r); }}
                  onMouseMove={() => setActif(i)}
                  className={cn('mx-1 px-2.5 py-1.5 rounded-md cursor-pointer', i === actif && 'bg-[var(--tblr-primary-lt)]')}
                >
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="shrink-0 font-mono text-xs" style={{ color: 'var(--tblr-muted)' }}>
                      <Surligne texte={r.numero} termes={termes} />
                    </span>
                    <span className={cn('min-w-0 truncate text-sm', r.kind !== 'ligne' && 'font-semibold')}>
                      <Surligne texte={r.libelle} termes={termes} />
                    </span>
                    {r.kind !== 'ligne' && (
                      <span className="shrink-0 ml-auto text-[0.6875rem] font-semibold px-1.5 rounded border" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
                        {t(`pro_search_kind_${r.kind}`)}
                      </span>
                    )}
                  </div>
                  {r.extrait && (
                    <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--tblr-muted)' }}>
                      {r.champ !== 'cctp' && r.champ !== 'localisation' ? null : (
                        <span className="font-semibold mr-1">{t(`pro_search_field_${r.champ}`)} :</span>
                      )}
                      <Surligne texte={r.extrait} termes={termes} />
                    </p>
                  )}
                  <p className="text-[0.6875rem] truncate" style={{ color: 'var(--tblr-muted)' }}>{r.contexte}</p>
                </li>
              ))}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
