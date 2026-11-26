import React, { useEffect, useRef, useState } from 'react';
import type { ArticleBibliotheque } from '../../types/library';
import { useRechercheArticles } from '../../hooks/useRechercheArticles';
import type { DossierPropose } from '../../lib/bibliothequeAutocompletion';
import { ListeArticlesBibliotheque } from './ListeArticlesBibliotheque';

export interface EditingCell {
  rowKey: string;
  field: string;
  value: string;
}

// Déclarés au niveau module : redéfinis à l'intérieur de DPGFWorkspace, ces
// composants changeaient d'identité à chaque rendu du parent, ce que React
// traite comme un composant entièrement différent — il démontait puis
// remontait l'input à chaque frappe, réinitialisant son état local `v` à la
// valeur d'origine. D'où le texte qui s'effaçait sauf à taper plus vite que
// le cycle de rendu, et l'édition qui ne se commitait jamais vraiment.
/**
 * Un champ texte dans une ligne `draggable` ne laisse pas poser le curseur à la
 * souris (le clic démarre un glisser, la sélection ne suit pas) : le navigateur
 * oblige alors à passer par les flèches. La ligne cesse donc d'être
 * glissable pendant que le pointeur survole le champ ou qu'il a le focus.
 * À étaler sur l'<input> : `<input {...sansGlisserPendantSaisie} />`.
 */
// Une ligne qui n'est pas glissable (draggable="false") n'est jamais touchée :
// seule celle qu'on a suspendue est rétablie (marqueur data-glisser-suspendu).
const ligneGlissable = (el: Element, suspendre_: boolean) => {
  const ligne = suspendre_ ? el.closest('[draggable="true"]') : el.closest('[data-glisser-suspendu]');
  if (!ligne) return;
  if (suspendre_) { ligne.setAttribute('data-glisser-suspendu', ''); ligne.setAttribute('draggable', 'false'); }
  else { ligne.removeAttribute('data-glisser-suspendu'); ligne.setAttribute('draggable', 'true'); }
};
export const sansGlisserPendantSaisie = {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => ligneGlissable(e.currentTarget, true),
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
    if (document.activeElement !== e.currentTarget) ligneGlissable(e.currentTarget, false);
  },
  onFocus: (e: React.FocusEvent<HTMLElement>) => ligneGlissable(e.currentTarget, true),
  onBlur: (e: React.FocusEvent<HTMLElement>) => ligneGlissable(e.currentTarget, false),
};

const sansAccent = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');

/**
 * Propositions pour la dernière valeur d'une liste séparée par des virgules :
 * celles qui contiennent ce qui est tapé, hors valeurs déjà saisies avant.
 */
export function propositionsListe(texte: string, suggestions: string[], max = 8): string[] {
  const morceaux = texte.split(',');
  const courant = sansAccent(morceaux[morceaux.length - 1].trim());
  const deja = new Set(morceaux.slice(0, -1).map(m => sansAccent(m.trim())));
  return suggestions
    .filter(s => !deja.has(sansAccent(s)) && (!courant || sansAccent(s).includes(courant)) && sansAccent(s) !== courant)
    .slice(0, max);
}

/** Remplace la dernière valeur de la liste par la proposition choisie. */
export function appliquerProposition(texte: string, proposition: string): string {
  const morceaux = texte.split(',').map(m => m.trim());
  morceaux[morceaux.length - 1] = proposition;
  return morceaux.filter((m, i) => m || i === morceaux.length - 1).join(', ');
}

export const CellInput = ({
  value, onCommit, onCancel, className = '', label, suggestions, articles,
}: {
  value: string; onCommit: (v: string) => void; onCancel: () => void; className?: string; label?: string;
  /** Valeurs proposées pendant la saisie ; plusieurs valeurs se séparent par des virgules. */
  suggestions?: string[];
  /** Auto-complétion depuis la bibliothèque d'ouvrages (désignation d'un article) : choisir une proposition la pose et ferme la saisie. */
  articles?: { onChoisir: (article: ArticleBibliotheque) => void; dossier?: DossierPropose };
}) => {
  const [v, setV] = useState(value);
  const choisi = useRef(false);
  const [actif, setActif] = useState(-1);
  const ref = useRef<HTMLInputElement>(null);
  // Échap retire le champ sans blur : la ligne glissable est alors rétablie ici.
  useEffect(() => {
    const ligne = ref.current?.closest('[draggable]');
    return () => {
      if (ligne?.hasAttribute('data-glisser-suspendu')) {
        ligne.removeAttribute('data-glisser-suspendu');
        ligne.setAttribute('draggable', 'true');
      }
    };
  }, []);
  const propositions = suggestions ? propositionsListe(v, suggestions) : [];
  // Les ouvrages ne sont cherchés qu'une fois le texte modifié : ouvrir la saisie ne propose rien.
  const trouves = useRechercheArticles(v, !!articles && v !== value, articles?.dossier);
  const nbListe = articles ? trouves.length : propositions.length;
  const choisirArticle = (a: ArticleBibliotheque) => {
    choisi.current = true; // le blur qui suit ne doit pas valider le texte tapé par-dessus l'article
    articles?.onChoisir(a);
    onCancel();
  };
  const rect = nbListe ? ref.current?.getBoundingClientRect() : undefined;
  const choisir = (proposition: string) => {
    setV(appliquerProposition(v, proposition) + ', ');
    setActif(-1);
    ref.current?.focus();
  };
  return (
    <>
      <input
        ref={ref}
        autoFocus
        aria-label={label}
        aria-autocomplete={suggestions ? 'list' : undefined}
        value={v}
        onChange={e => { setV(e.target.value); setActif(-1); }}
        onMouseEnter={sansGlisserPendantSaisie.onMouseEnter}
        onMouseLeave={sansGlisserPendantSaisie.onMouseLeave}
        onFocus={e => { sansGlisserPendantSaisie.onFocus(e); e.target.select(); }}
        onBlur={e => { sansGlisserPendantSaisie.onBlur(e); if (!choisi.current) onCommit(v); }}
        onKeyDown={e => {
          // Les raccourcis du tableau (Tab, Suppr, Alt+flèches) ne doivent pas
          // agir sur la ligne pendant la saisie.
          e.stopPropagation();
          if (nbListe && e.key === 'ArrowDown') { e.preventDefault(); setActif(a => (a + 1) % nbListe); return; }
          if (nbListe && e.key === 'ArrowUp') { e.preventDefault(); setActif(a => (a <= 0 ? nbListe : a) - 1); return; }
          if (e.key === 'Enter' && actif >= 0 && articles && trouves[actif]) { e.preventDefault(); choisirArticle(trouves[actif]); return; }
          if (e.key === 'Enter' && actif >= 0 && propositions[actif]) { e.preventDefault(); choisir(propositions[actif]); return; }
          if (e.key === 'Enter') { onCommit(v); e.currentTarget.blur(); }
          if (e.key === 'Escape') { onCancel(); }
        }}
        className={`w-full px-1 py-0 rounded outline-none text-sm font-mono border border-[var(--tblr-primary)] bg-[var(--tblr-surface)] text-[var(--tblr-text)] ${className}`}
      />
      {rect && articles && (
        <ListeArticlesBibliotheque
          articles={trouves} actif={actif} onChoisir={choisirArticle} className="fixed"
          style={{ top: rect.bottom + 2, left: rect.left, minWidth: Math.max(rect.width, 280) }}
        />
      )}
      {rect && !articles && (
        // Position fixe : le tableau défile et couperait une liste posée dans la cellule.
        <ul
          role="listbox"
          className="fixed z-50 max-h-48 overflow-auto rounded border shadow-lg text-xs py-1"
          style={{ top: rect.bottom + 2, left: rect.left, minWidth: Math.max(rect.width, 160), background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        >
          {propositions.map((p, i) => (
            <li
              key={p}
              role="option"
              aria-selected={i === actif}
              // mousedown plutôt que click : le champ perdrait le focus (et validerait) avant.
              onMouseDown={e => { e.preventDefault(); choisir(p); }}
              className="px-2 py-1 cursor-pointer hover:bg-[var(--tblr-surface-2)]"
              style={i === actif ? { background: 'var(--tblr-primary-lt)' } : undefined}
            >
              {p}
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export const EditableCell = ({
  rKey, field, value, editingCell, onStartEdit, onCommit, onCancel, numeric = false, className = '', editOnClick = false, label, showZero = false, pm = false, suggestions, articles, maxDecimals = 2, editValue, titleHint,
}: {
  rKey: string; field: string; value: string | number; editingCell: EditingCell | null;
  onStartEdit: (rKey: string, field: string, value: string | number) => void;
  onCommit: (v: string) => void; onCancel: () => void; numeric?: boolean; className?: string;
  /** Sur téléphone, un appui suffit : le double appui y zoome ou n'arrive jamais. */
  editOnClick?: boolean;
  /** Nom du champ, annoncé pendant la saisie. */
  label?: string;
  /** Affiche « 0,00 » plutôt qu'une case vide (quantité attendue d'un bâtiment coché). */
  showZero?: boolean;
  /** Prix « pour mémoire » : affiche et édite « PM » au lieu d'un montant. */
  pm?: boolean;
  /** Valeurs proposées pendant la saisie (liste séparée par des virgules). */
  suggestions?: string[];
  /** Auto-complétion depuis la bibliothèque d'ouvrages (désignation d'un article). */
  articles?: { onChoisir: (article: ArticleBibliotheque) => void; dossier?: DossierPropose };
  /** Décimales affichées au plus (2 par défaut ; une quantité n'est jamais arrondie à l'écran). */
  maxDecimals?: number;
  /** Texte de départ de la modification, à la place de la valeur affichée (la formule mémorisée d'une quantité). */
  editValue?: string;
  /** Infobulle de la cellule au repos, à la place de « Double-clic pour éditer ». */
  titleHint?: string;
}) => {
  const isEditing = editingCell?.rowKey === rKey && editingCell?.field === field;
  const display = pm
    ? 'PM'
    : numeric && typeof value === 'number' && (value > 0 || (showZero && value === 0))
    ? new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: Math.max(2, maxDecimals) }).format(value)
    : String(value || '');

  if (isEditing) {
    return <CellInput value={editingCell.value} onCommit={onCommit} onCancel={onCancel} className={className} label={label} suggestions={suggestions} articles={articles} />;
  }
  return (
    <div
      onDoubleClick={() => onStartEdit(rKey, field, pm ? 'PM' : editValue ?? value)}
      onClick={editOnClick ? e => { e.stopPropagation(); onStartEdit(rKey, field, pm ? 'PM' : editValue ?? value); } : undefined}
      className={`px-1 py-0.5 cursor-text rounded min-h-[22px] hover:bg-[var(--tblr-surface-2)] ${numeric ? 'text-right font-mono tabular-nums' : ''} ${className}`}
      title={titleHint ?? (editOnClick ? undefined : 'Double-clic pour éditer')}
    >
      {display}
    </div>
  );
};
