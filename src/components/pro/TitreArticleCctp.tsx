import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ArticleBibliotheque } from '../../types/library';
import { useRechercheArticles } from '../../hooks/useRechercheArticles';
import { ListeArticlesBibliotheque } from './ListeArticlesBibliotheque';

/**
 * Titre d'un article du CCTP, avec les ouvrages de la bibliothèque proposés pendant la saisie. Les propositions
 * n'apparaissent qu'une fois le titre modifié (ouvrir une fiche ne propose rien). Les flèches choisissent, Entrée
 * valide la proposition surlignée, Échap ferme la liste ; sans proposition surlignée le titre reste ce qui est tapé.
 */
export function TitreArticleCctp({ value, onChange, onChoisir, className, placeholder }: {
  value: string; onChange: (titre: string) => void; onChoisir: (article: ArticleBibliotheque) => void;
  className?: string; placeholder?: string;
}) {
  const { t } = useTranslation();
  const [modifie, setModifie] = useState(false);
  const [ferme, setFerme] = useState(false);
  const [actif, setActif] = useState(-1);
  const champ = useRef<HTMLInputElement>(null);
  const propositions = useRechercheArticles(value, modifie && !ferme);

  const choisir = (a: ArticleBibliotheque) => { setFerme(true); setActif(-1); onChoisir(a); };
  return (
    <div className="relative">
      <input
        ref={champ}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-label={t('pro_description_title_label')}
        onChange={e => { setModifie(true); setFerme(false); setActif(-1); onChange(e.target.value); }}
        onBlur={() => setFerme(true)}
        onKeyDown={e => {
          if (!propositions.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActif(a => (a + 1) % propositions.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActif(a => (a <= 0 ? propositions.length : a) - 1); }
          else if (e.key === 'Enter' && actif >= 0 && propositions[actif]) { e.preventDefault(); choisir(propositions[actif]); }
          else if (e.key === 'Escape') { setFerme(true); }
        }}
        className={className}
      />
      {!ferme && <ListeArticlesBibliotheque articles={propositions} actif={actif} onChoisir={choisir} className="absolute left-0 right-0 mt-1" />}
    </div>
  );
}
