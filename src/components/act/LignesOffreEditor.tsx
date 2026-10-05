// Options et variantes d'une offre (la base reste `Offre.montant_base`).
// Même éditeur à l'ouverture des plis (phase « Collecte ») et en négociation.
import { IconPlus, IconTrash } from '@tabler/icons-react';
import {
  ajouterLigne, negociationVide, remplacerNegociation, retirerLigne, trouverNegociation,
  type LigneKind, type Negociation,
} from '../../lib/actNegociation';
import { BOUTON, CHAMP, NumInput } from './negociationUi';

interface Props {
  lotId: string;
  entrepriseId: string;
  negociations: Negociation[] | undefined;
  onChange: (next: Negociation[]) => void;
}

export default function LignesOffreEditor({ lotId, entrepriseId, negociations, onChange }: Props) {
  const neg = trouverNegociation(negociations, lotId, entrepriseId) ?? negociationVide(lotId, entrepriseId);
  const maj = (next: Negociation) => onChange(remplacerNegociation(negociations, next));
  const ajouter = (kind: LigneKind) => maj(ajouterLigne(neg, kind, crypto.randomUUID()));

  return (
    <div className="space-y-2">
      {neg.lignes.length === 0 && (
        <p className="text-[0.6875rem] text-[var(--tblr-muted)] italic">
          Aucune option ni variante. La base seule fait l'offre ; les options s'ajoutent au total, les variantes restent des offres de substitution.
        </p>
      )}
      {neg.lignes.map(l => (
        <div key={l.id} className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Nature de la ligne" className={CHAMP} value={l.kind}
            onChange={e => maj({ ...neg, lignes: neg.lignes.map(x => (x.id === l.id ? { ...x, kind: e.target.value as LigneKind } : x)) })}
          >
            <option value="option">Option</option>
            <option value="variante">Variante</option>
          </select>
          <input
            aria-label="Libellé" className={`${CHAMP} flex-1 min-w-[10rem]`} value={l.libelle}
            onChange={e => maj({ ...neg, lignes: neg.lignes.map(x => (x.id === l.id ? { ...x, libelle: e.target.value } : x)) })}
          />
          <div className="w-36">
            <NumInput
              label={`Montant HT de ${l.libelle}`} value={l.montant_ouverture || undefined}
              onChange={v => maj({ ...neg, lignes: neg.lignes.map(x => (x.id === l.id ? { ...x, montant_ouverture: v ?? 0 } : x)) })}
            />
          </div>
          <button type="button" aria-label={`Retirer ${l.libelle}`} onClick={() => maj(retirerLigne(neg, l.id))} className="p-1.5 text-zinc-400 hover:text-red-500">
            <IconTrash size={14} />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" className={BOUTON} onClick={() => ajouter('option')}><IconPlus size={12} /> Option</button>
        <button type="button" className={BOUTON} onClick={() => ajouter('variante')}><IconPlus size={12} /> Variante</button>
      </div>
    </div>
  );
}
