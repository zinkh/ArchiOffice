// Champ « Entreprise » avec autocomplétion sur les entreprises de la consultation : on tape quelques
// lettres du nom, la liste se réduit (accents et majuscules ignorés), flèches + Entrée ou clic pour
// choisir. Un nom absent de la liste reste saisissable tel quel (entreprise hors consultation).
// Distinct de `EntrepriseAutocomplete` (fiches contacts, avec création de fiche).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconCheck, IconSearch } from '@tabler/icons-react';
import { rechercherEntreprises } from '../../lib/offresRecues';

interface Entreprise { id: string; nom: string }

interface Props {
  entreprises: Entreprise[];
  /** Texte affiché dans le champ. */
  valeur: string;
  /** Entreprise de la consultation reconnue (absente : nom saisi librement). */
  entrepriseId?: string;
  onChange: (nom: string, entreprise?: Entreprise) => void;
  placeholder?: string;
  className?: string;
}

export function EntrepriseConsulteeCombobox({
  entreprises, valeur, entrepriseId, onChange, placeholder = 'Rechercher ou saisir une entreprise…', className,
}: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(0);
  // Le texte n'est filtré qu'une fois modifié : à l'ouverture sur une entreprise déjà choisie, toutes restent visibles.
  const [filtre, setFiltre] = useState('');
  const racine = useRef<HTMLDivElement>(null);
  const idListe = useId();
  const propositions = useMemo(() => rechercherEntreprises(entreprises, filtre), [entreprises, filtre]);

  useEffect(() => {
    const fermer = (e: MouseEvent) => { if (!racine.current?.contains(e.target as Node)) setOuvert(false); };
    document.addEventListener('mousedown', fermer);
    return () => document.removeEventListener('mousedown', fermer);
  }, []);

  const choisir = (e: Entreprise) => { onChange(e.nom, e); setFiltre(''); setOuvert(false); };

  const toucheClavier = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setOuvert(true); setActif(a => Math.min(a + 1, Math.max(0, propositions.length - 1))); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActif(a => Math.max(a - 1, 0)); }
    else if (ev.key === 'Enter' && ouvert && propositions[actif]) { ev.preventDefault(); choisir(propositions[actif]); }
    else if (ev.key === 'Escape' && ouvert) { ev.stopPropagation(); setOuvert(false); }
  };

  return (
    <div ref={racine} className="relative">
      <IconSearch size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
      <input
        role="combobox" aria-expanded={ouvert} aria-controls={idListe} aria-autocomplete="list"
        aria-activedescendant={ouvert && propositions[actif] ? `${idListe}-${propositions[actif].id}` : undefined}
        className={`${className ?? ''} !pl-7`} placeholder={placeholder} value={valeur} autoComplete="off"
        onFocus={() => setOuvert(true)}
        onChange={e => { setFiltre(e.target.value); setActif(0); setOuvert(true); onChange(e.target.value, undefined); }}
        onKeyDown={toucheClavier}
      />
      {ouvert && (
        <ul id={idListe} role="listbox" className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded border border-zinc-300 bg-white dark:bg-zinc-900 shadow-lg text-sm">
          {propositions.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-500">
              Aucune entreprise de la consultation ne correspond{valeur.trim() ? <> : « {valeur.trim()} » sera saisie telle quelle.</> : '.'}
            </li>
          ) : propositions.map((e, i) => (
            <li
              key={e.id} id={`${idListe}-${e.id}`} role="option" aria-selected={e.id === entrepriseId}
              onMouseDown={ev => { ev.preventDefault(); choisir(e); }} onMouseEnter={() => setActif(i)}
              className={`px-3 py-1.5 cursor-pointer flex items-center justify-between gap-2 ${i === actif ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
            >
              <span className="truncate">{e.nom}</span>
              {e.id === entrepriseId && <IconCheck size={13} className="shrink-0 text-green-600" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
