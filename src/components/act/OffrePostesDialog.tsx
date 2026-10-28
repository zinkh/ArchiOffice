// Saisie poste par poste de l'offre d'une entreprise sur un lot : un prix
// unitaire par article du document de référence, en regard de l'estimation.
// Le total du lot est calculé, jamais saisi. Les prix peuvent se coller depuis
// un tableur (une colonne collée remplit les lignes à partir de la case active).
import React, { useMemo, useRef, useState } from 'react';
import { IconPlus, IconTrash, IconX, IconLoader2 } from '@tabler/icons-react';
import type { Lot, PosteAjoute } from '../../types/dpgf';
import { chapitresDuLot, ecartPct, estHorsBase, niveauEcart, eur0, eur2, pctFr as pct, type PrixSaisi } from '../../lib/comparatifPrix';
import { montantPoste } from '../../lib/postesAjoutes';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface Props {
  lot: Lot;
  entreprise: { id: string; nom: string };
  prixInitial: Record<string, PrixSaisi>;
  ajoutsInitiaux: PosteAjoute[];
  onSave: (prix: Record<string, PrixSaisi>, ajouts: PosteAjoute[]) => Promise<void>;
  onClose: () => void;
}

interface AjoutBrouillon {
  id: string; numero: string; designation: string; unite: string; quantite: string; prixUnitaire: string;
}

/** « 1 234,50 € » ou « 1234.5 » : nombre positif, ou null si le texte n'en est pas un. */
export function lireNombre(texte: string): number | null {
  const nettoye = texte.replace(/[\s  €]/g, '').replace(',', '.');
  if (nettoye === '') return null;
  const n = Number(nettoye);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const CHAMP = 'w-full text-right px-2 py-1 text-sm border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50';
const BOUTON = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50';
const BOUTON_PRIMAIRE = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--tblr-primary)] text-white hover:opacity-90 disabled:opacity-50';

export default function OffrePostesDialog({ lot, entreprise, prixInitial, ajoutsInitiaux, onSave, onClose }: Props) {
  const chapitres = useMemo(() => chapitresDuLot(lot), [lot]);
  const lignes = useMemo(() => chapitres.flatMap(c => c.lignes), [chapitres]);

  const [valeurs, setValeurs] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const l of lignes) { const pu = prixInitial[l.id]; if (typeof pu === 'number') v[l.id] = String(pu).replace('.', ','); }
    return v;
  });
  const [pm, setPm] = useState<Record<string, boolean>>(() => {
    const p: Record<string, boolean> = {};
    for (const l of lignes) if (prixInitial[l.id] === null) p[l.id] = true;
    return p;
  });
  const [ajouts, setAjouts] = useState<AjoutBrouillon[]>(() => ajoutsInitiaux.map(p => ({
    id: p.id, numero: p.numero, designation: p.designation, unite: p.unite,
    quantite: p.quantite != null ? String(p.quantite) : '', prixUnitaire: p.prixUnitaire != null ? String(p.prixUnitaire).replace('.', ',') : '',
  })));
  const [modifie, setModifie] = useState(false);
  const [abandon, setAbandon] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const champs = useRef<Array<HTMLInputElement | null>>([]);

  const tenterFermer = () => { if (modifie) setAbandon(true); else onClose(); };
  useEscapeKey(!enCours, tenterFermer);

  const total = useMemo(() => {
    let t = 0;
    for (const l of lignes) {
      const pu = lireNombre(valeurs[l.id] ?? '');
      if (!pm[l.id] && pu != null && !estHorsBase(l)) t += pu * l.quantite;
    }
    for (const a of ajouts) {
      const pu = lireNombre(a.prixUnitaire);
      if (pu != null) t += pu * (lireNombre(a.quantite) ?? 1);
    }
    return t;
  }, [lignes, valeurs, pm, ajouts]);

  const saisir = (id: string, texte: string) => { setValeurs(v => ({ ...v, [id]: texte })); setModifie(true); };
  const basculerPm = (id: string, actif: boolean) => {
    setPm(p => ({ ...p, [id]: actif }));
    if (actif) setValeurs(v => { const { [id]: _retire, ...reste } = v; return reste; });
    setModifie(true);
  };

  const collerColonne = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const morceaux = e.clipboardData.getData('text').split(/\r?\n/).filter(m => m.trim() !== '');
    if (morceaux.length < 2) return; // une seule valeur : collage normal
    e.preventDefault();
    const nouveau: Record<string, string> = {};
    morceaux.forEach((m, i) => {
      const ligne = lignes[index + i];
      if (!ligne) return;
      const cellule = m.split('\t').pop() ?? m;
      const n = lireNombre(cellule);
      if (n != null) nouveau[ligne.id] = String(n).replace('.', ',');
    });
    setValeurs(v => ({ ...v, ...nouveau }));
    setPm(p => { const c = { ...p }; for (const id of Object.keys(nouveau)) delete c[id]; return c; });
    setModifie(true);
  };

  const versSuivant = (index: number, e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const suivant = champs.current.slice(index + 1).find(c => c && !c.disabled);
    suivant?.focus();
    suivant?.select();
  };

  const majAjout = (id: string, patch: Partial<AjoutBrouillon>) => {
    setAjouts(a => a.map(x => (x.id === id ? { ...x, ...patch } : x)));
    setModifie(true);
  };

  const enregistrer = async () => {
    setEnCours(true); setErreur(null);
    try {
      const prix: Record<string, PrixSaisi> = {};
      for (const l of lignes) {
        if (pm[l.id]) prix[l.id] = null;
        else { const n = lireNombre(valeurs[l.id] ?? ''); prix[l.id] = n ?? undefined; }
      }
      const postes: PosteAjoute[] = ajouts
        .filter(a => a.designation.trim() !== '')
        .map(a => ({
          id: a.id, numero: a.numero.trim(), designation: a.designation.trim(), unite: a.unite.trim() || 'u',
          quantite: lireNombre(a.quantite), prixUnitaire: lireNombre(a.prixUnitaire), lotId: lot.id,
        }));
      await onSave(prix, postes);
      onClose();
    } catch (e: any) {
      setErreur(e?.message || 'L’offre n’a pas pu être enregistrée.');
    } finally {
      setEnCours(false);
    }
  };

  let index = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/50 p-3 sm:p-4" onClick={tenterFermer}>
      <div
        role="dialog" aria-modal="true" aria-label={`Saisir les postes de ${entreprise.nom}`}
        className="rounded-xl shadow-xl w-full max-w-5xl max-h-[92dvh] flex flex-col"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 flex justify-between items-start gap-3" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <div className="min-w-0">
            <h3 className="text-base font-bold">Offre de {entreprise.nom}</h3>
            <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
              Lot {lot.numero} : {lot.titre}. Saisissez le prix unitaire HT de chaque poste ; le total du lot se calcule.
              Une colonne copiée depuis un tableur se colle dans la première case.
            </p>
          </div>
          <button type="button" onClick={tenterFermer} aria-label="Fermer" style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>

        <div className="overflow-auto flex-1">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-[var(--tblr-surface-2)] sticky top-0 z-10">
              <tr className="text-[0.6875rem] uppercase tracking-wider text-[var(--tblr-muted)]">
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Désignation</th>
                <th className="px-3 py-2 text-center">U</th>
                <th className="px-3 py-2 text-right">Qté</th>
                <th className="px-3 py-2 text-right">Estimation</th>
                <th className="px-3 py-2 text-right w-36">P.U. HT remis</th>
                <th className="px-3 py-2 text-center" title="Pour mémoire : compris dans un autre poste, non compté">P.m.</th>
                <th className="px-3 py-2 text-right">Total ligne</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--tblr-border)]">
              {chapitres.map(c => (
                <React.Fragment key={c.id}>
                  <tr className="bg-[var(--tblr-surface-2)]">
                    <td className="px-3 py-1.5 text-xs font-bold" colSpan={8}>{c.numero} {c.titre}</td>
                  </tr>
                  {c.lignes.map(l => {
                    index += 1;
                    const i = index;
                    const texte = valeurs[l.id] ?? '';
                    const pu = lireNombre(texte);
                    const ec = pu != null ? ecartPct(pu, l.prixUnitaire) : null;
                    const niveau = niveauEcart(ec);
                    return (
                      <tr key={l.id}>
                        <td className="px-3 py-1.5 text-xs text-[var(--tblr-muted)]">{l.numero}</td>
                        <td className="px-3 py-1.5">
                          {l.designation}
                          {estHorsBase(l) && <span className="ml-2 text-[0.6875rem] font-bold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">Hors base</span>}
                        </td>
                        <td className="px-3 py-1.5 text-center text-[var(--tblr-muted)]">{l.unite}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{l.quantite.toLocaleString('fr-FR')}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[var(--tblr-muted)]">{eur2(l.prixUnitaire)}</td>
                        <td className="px-3 py-1.5">
                          <input
                            ref={el => { champs.current[i] = el; }}
                            inputMode="decimal" className={CHAMP} value={texte} disabled={!!pm[l.id]}
                            aria-label={`P.U. HT ${l.designation}`}
                            onChange={e => saisir(l.id, e.target.value)}
                            onPaste={e => collerColonne(i, e)}
                            onKeyDown={e => versSuivant(i, e)}
                            placeholder={pm[l.id] ? 'p.m.' : ''}
                          />
                          {ec != null && (
                            <span className={`block text-right text-[0.6875rem] tabular-nums ${niveau === 'haut' ? 'text-red-600 dark:text-red-400 font-bold' : niveau === 'bas' ? 'text-amber-700 dark:text-amber-400 font-bold' : 'text-[var(--tblr-muted)]'}`}>
                              {pct(ec)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input type="checkbox" checked={!!pm[l.id]} onChange={e => basculerPm(l.id, e.target.checked)} aria-label={`Pour mémoire : ${l.designation}`} />
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{pu != null && !pm[l.id] ? eur0(pu * l.quantite) : <span className="text-[var(--tblr-muted)]">·</span>}</td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
              {lignes.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center italic text-[var(--tblr-muted)]">Ce lot ne contient aucun article chiffrable dans le document de référence.</td></tr>
              )}
              {ajouts.length > 0 && (
                <tr className="bg-violet-50 dark:bg-violet-900/20"><td className="px-3 py-1.5 text-xs font-bold text-violet-800 dark:text-violet-200" colSpan={8}>Postes ajoutés par l’entreprise</td></tr>
              )}
              {ajouts.map(a => (
                <tr key={a.id} className="bg-violet-50/60 dark:bg-violet-900/10">
                  <td className="px-3 py-1.5"><input className={`${CHAMP} text-left`} value={a.numero} onChange={e => majAjout(a.id, { numero: e.target.value })} aria-label="Code du poste ajouté" /></td>
                  <td className="px-3 py-1.5"><input className={`${CHAMP} text-left`} value={a.designation} onChange={e => majAjout(a.id, { designation: e.target.value })} aria-label="Désignation du poste ajouté" placeholder="Désignation" /></td>
                  <td className="px-3 py-1.5"><input className={`${CHAMP} text-center`} value={a.unite} onChange={e => majAjout(a.id, { unite: e.target.value })} aria-label="Unité" placeholder="u" /></td>
                  <td className="px-3 py-1.5"><input inputMode="decimal" className={CHAMP} value={a.quantite} onChange={e => majAjout(a.id, { quantite: e.target.value })} aria-label="Quantité annoncée" placeholder="1" /></td>
                  <td className="px-3 py-1.5 text-right text-[var(--tblr-muted)]">·</td>
                  <td className="px-3 py-1.5"><input inputMode="decimal" className={CHAMP} value={a.prixUnitaire} onChange={e => majAjout(a.id, { prixUnitaire: e.target.value })} aria-label="P.U. du poste ajouté" /></td>
                  <td className="px-3 py-1.5 text-center">
                    <button type="button" aria-label="Retirer ce poste" className="text-zinc-400 hover:text-red-500" onClick={() => { setAjouts(x => x.filter(y => y.id !== a.id)); setModifie(true); }}><IconTrash size={14} /></button>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {lireNombre(a.prixUnitaire) != null
                      ? eur0(montantPoste({ id: a.id, numero: '', designation: '', unite: '', quantite: lireNombre(a.quantite), prixUnitaire: lireNombre(a.prixUnitaire) }))
                      : <span className="text-[var(--tblr-muted)]">·</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {abandon && (
          <div role="alertdialog" aria-label="Abandonner les modifications" className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm bg-amber-50 dark:bg-amber-900/20" style={{ borderTop: '1px solid var(--tblr-border)' }}>
            <span>Les modifications de cette offre ne sont pas enregistrées.</span>
            <span className="flex gap-2">
              <button type="button" className={BOUTON} onClick={() => setAbandon(false)}>Continuer la saisie</button>
              <button type="button" className={BOUTON} onClick={onClose}>Abandonner</button>
            </span>
          </div>
        )}

        <div className="p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderTop: '1px solid var(--tblr-border)' }}>
          <button type="button" className={BOUTON} onClick={() => { setAjouts(a => [...a, { id: crypto.randomUUID(), numero: `A.${a.length + 1}`, designation: '', unite: 'u', quantite: '', prixUnitaire: '' }]); setModifie(true); }}>
            <IconPlus size={13} /> Poste ajouté par l’entreprise
          </button>
          <div className="flex flex-wrap items-center gap-3">
            {erreur && <span role="alert" className="text-xs text-red-600 dark:text-red-400">{erreur}</span>}
            <span className="text-sm">Total du lot HT : <b className="tabular-nums">{eur0(total)}</b></span>
            <button type="button" className={BOUTON} onClick={tenterFermer} disabled={enCours}>Annuler</button>
            <button type="button" className={BOUTON_PRIMAIRE} onClick={enregistrer} disabled={enCours || !modifie}>
              {enCours && <IconLoader2 size={13} className="animate-spin" />} Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
