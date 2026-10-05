// Fiches de négociation : un bloc par lot, une fiche par entreprise.
// Prix d'ouverture → prix vérifié → tours de négociation datés → objectif.
// Tout ce qui se calcule (total, gain, reste à obtenir, statut) est lu depuis
// src/lib/actNegociation.ts et jamais saisi.
import { useState } from 'react';
import {
  IconChevronDown, IconChevronRight, IconDownload, IconPlus, IconTrash, IconBan,
} from '@tabler/icons-react';
import type { ProjectLot } from '../../types';
import type { AgencySettings } from '../../lib/proposalExport';
import { cn } from '../../lib/utils';
import {
  BASE_KEY, aujourdhui, clesLignes, gainObtenu, montantCourant, montantOuverture,
  montantVerifie, negociationVide, objectifTotal, remplacerNegociation, reperesLot,
  resteAObtenir, statutNegociation, toursOrdonnes, totalA, trouverNegociation,
  type Negociation, type OffreMontant, type TourNegociation,
} from '../../lib/actNegociation';
import { genererFicheNegociation, type ConsultationNegociationExport } from '../../lib/actNegociationExport';
import LignesOffreEditor from './LignesOffreEditor';
import { BOUTON, CARTE_STYLE, CHAMP, ENTETE_TH, Ecart, NumInput, StatutPastille, eur } from './negociationUi';

interface Props {
  lots: ProjectLot[];
  consultation: ConsultationNegociationExport;
  projectName: string;
  settings: AgencySettings;
  onNegociations: (next: Negociation[]) => void;
}

export default function NegociationPanel({ lots, consultation, projectName, settings, onNegociations }: Props) {
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const basculer = (cle: string) => setOuvertes(prev => {
    const n = new Set(prev);
    if (n.has(cle)) n.delete(cle); else n.add(cle);
    return n;
  });

  const negs = consultation.negociations;
  if (lots.length === 0) {
    return <div className="rounded-lg p-8 text-center text-[var(--tblr-muted)] italic" style={CARTE_STYLE}>Aucun lot défini. Créez les lots en phase 1.</div>;
  }

  return (
    <div className="space-y-5">
      {lots.map(lot => {
        const entreprisesLot = consultation.entreprises.filter(e => (e.lots_ids ?? []).includes(lot.id));
        const repere = reperesLot(consultation.offres, negs, lot.id, 'courant');
        const repereOuverture = reperesLot(consultation.offres, negs, lot.id, 'ouverture');
        const attribution = consultation.attributions.find(a => a.lot_id === lot.id);
        return (
          <section key={lot.id} className="rounded-lg overflow-hidden" style={CARTE_STYLE} aria-label={`Lot ${lot.lot_number}`}>
            <div className="p-4 border-b border-[var(--tblr-border)] flex flex-wrap items-center gap-x-6 gap-y-2">
              <h3 className="text-sm font-bold text-[var(--tblr-text)]">
                <span className="mr-2 px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-[0.6875rem] font-black">Lot {lot.lot_number}</span>
                {lot.lot_title}
              </h3>
              <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[0.6875rem] text-[var(--tblr-muted)] ml-auto">
                <div><dt className="inline">Moins-disant à l'ouverture : </dt><dd className="inline font-bold text-[var(--tblr-text)]">{eur(repereOuverture.base)}</dd></div>
                <div><dt className="inline">Moins-disant actuel : </dt><dd className="inline font-bold text-[var(--tblr-text)]">{eur(repere.base)}</dd></div>
                <div><dt className="inline">Moyenne des offres : </dt><dd className="inline font-bold text-[var(--tblr-text)]">{eur(repere.moyenneBase)}</dd></div>
              </dl>
            </div>
            {entreprisesLot.length === 0 && (
              <p className="px-4 py-6 text-center text-sm italic text-[var(--tblr-muted)]">Aucune entreprise affectée à ce lot (phase 1).</p>
            )}
            <ul className="divide-y divide-[var(--tblr-border)]">
              {entreprisesLot.map(ent => {
                const cle = `${lot.id}:${ent.id}`;
                const offre = consultation.offres.find(o => o.lot_id === lot.id && o.entreprise_id === ent.id);
                const neg = trouverNegociation(negs, lot.id, ent.id);
                const attribue = attribution?.entreprise_id === ent.id;
                const statut = statutNegociation(neg, offre, attribue);
                const ouverte = ouvertes.has(cle);
                const estMoinsDisant = repere.moinsDisantId === ent.id;
                return (
                  <li key={ent.id}>
                    <button
                      type="button" aria-expanded={ouverte} onClick={() => basculer(cle)}
                      className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                    >
                      {ouverte ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                      <span className="font-bold text-sm text-[var(--tblr-text)] min-w-[10rem]">{ent.nom}</span>
                      <StatutPastille statut={statut} />
                      {estMoinsDisant && <span className="text-[0.6875rem] font-bold text-green-700 dark:text-green-400">Moins-disant</span>}
                      <span className="ml-auto flex gap-5 text-xs text-[var(--tblr-muted)]">
                        <span>Ouverture <b className="text-[var(--tblr-text)]">{eur(totalA(offre, neg, 'ouverture'))}</b></span>
                        <span>Actuel <b className="text-[var(--tblr-text)]">{eur(totalA(offre, neg, 'courant'))}</b></span>
                        <span>Gain <b className="text-green-700 dark:text-green-400">{eur(gainObtenu(offre, neg))}</b></span>
                      </span>
                    </button>
                    {ouverte && (
                      <Fiche
                        lot={lot} entreprise={ent} offre={offre} neg={neg} negs={negs}
                        onNegociations={onNegociations}
                        onPdf={() => genererFicheNegociation(lot, ent, consultation, projectName, settings)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ── Fiche d'une entreprise ───────────────────────────────────────────────────

interface FicheProps {
  lot: ProjectLot;
  entreprise: { id: string; nom: string; email?: string };
  offre: OffreMontant | undefined;
  neg: Negociation | undefined;
  negs: Negociation[] | undefined;
  onNegociations: (next: Negociation[]) => void;
  onPdf: () => void;
}

function Fiche({ lot, entreprise, offre, neg, negs, onNegociations, onPdf }: FicheProps) {
  const courante = neg ?? negociationVide(lot.id, entreprise.id);
  const maj = (next: Negociation) => onNegociations(remplacerNegociation(negs, next));
  const cles = clesLignes(courante);
  const libelle = (cle: string) => (cle === BASE_KEY ? 'Base' : courante.lignes.find(l => l.id === cle)?.libelle ?? cle);
  const tours = toursOrdonnes(courante);
  const reste = resteAObtenir(offre, courante);

  const ajouterTour = () => {
    const tour: TourNegociation = { id: crypto.randomUUID(), date: aujourdhui(), montants: {} };
    maj({ ...courante, tours: [...courante.tours, tour] });
  };
  const majTour = (id: string, patch: Partial<TourNegociation>) =>
    maj({ ...courante, tours: courante.tours.map(t => (t.id === id ? { ...t, ...patch } : t)) });
  const majMontantTour = (id: string, cle: string, v: number | undefined) => {
    const tour = courante.tours.find(t => t.id === id);
    if (!tour) return;
    const { [cle]: _ancien, ...reste } = tour.montants;
    majTour(id, { montants: v == null ? reste : { ...reste, [cle]: v } });
  };
  const majRecord = (champ: 'montants_verifies' | 'objectifs', cle: string, v: number | undefined) => {
    const { [cle]: _ancien, ...autres } = courante[champ] ?? {};
    maj({ ...courante, [champ]: v == null ? autres : { ...autres, [cle]: v } });
  };

  return (
    <div className="px-4 pb-5 pt-2 space-y-5 bg-[var(--tblr-surface-2)]/40">
      {/* Offre décomposée */}
      <div>
        <h4 className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)] mb-2">Options et variantes</h4>
        <LignesOffreEditor lotId={lot.id} entrepriseId={entreprise.id} negociations={negs} onChange={onNegociations} />
      </div>

      {/* Prix : ouverture, vérifié, objectif, actuel */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr>
              <th className={cn(ENTETE_TH, 'text-left')}>Ligne</th>
              <th className={cn(ENTETE_TH, 'text-right')}>Ouverture</th>
              <th className={cn(ENTETE_TH, 'text-right w-40')}>Prix vérifié</th>
              <th className={cn(ENTETE_TH, 'text-right w-40')}>Objectif</th>
              <th className={cn(ENTETE_TH, 'text-right')}>Actuel</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--tblr-border)]">
            {cles.map(cle => (
              <tr key={cle}>
                <td className="px-3 py-2 font-medium">{libelle(cle)}</td>
                <td className="px-3 py-2 text-right">{eur(montantOuverture(offre, courante, cle))}</td>
                <td className="px-3 py-1.5">
                  <NumInput
                    label={`Prix vérifié, ${libelle(cle)}`} value={courante.montants_verifies?.[cle]}
                    placeholder={String(montantOuverture(offre, courante, cle))}
                    onChange={v => majRecord('montants_verifies', cle, v)}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <NumInput
                    label={`Objectif, ${libelle(cle)}`} value={courante.objectifs?.[cle]}
                    placeholder={String(montantVerifie(offre, courante, cle))}
                    onChange={v => majRecord('objectifs', cle, v)}
                  />
                </td>
                <td className="px-3 py-2 text-right font-bold">{eur(montantCourant(offre, courante, cle))}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="px-3 py-2">Total base + options</td>
              <td className="px-3 py-2 text-right">{eur(totalA(offre, courante, 'ouverture'))}</td>
              <td className="px-3 py-2 text-right">{eur(totalA(offre, courante, 'verifie'))}</td>
              <td className="px-3 py-2 text-right">{eur(objectifTotal(offre, courante))}</td>
              <td className="px-3 py-2 text-right">{eur(totalA(offre, courante, 'courant'))}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-[0.6875rem] text-[var(--tblr-muted)]">
          Reste à obtenir sur l'objectif : <Ecart valeur={reste} />. Laisser vide un prix vérifié ou un objectif reprend la valeur précédente.
        </p>
      </div>

      {/* Vérification */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="w-4 h-4 accent-green-600" checked={!!courante.verifie}
            onChange={e => maj({ ...courante, verifie: e.target.checked })} />
          Prix vérifiés
        </label>
        <input
          aria-label="Remarque de vérification" className={cn(CHAMP, 'flex-1 min-w-[14rem]')}
          placeholder="Ex. pas d'anomalie comptable, erreur de report corrigée"
          value={courante.remarque_verification ?? ''}
          onChange={e => maj({ ...courante, remarque_verification: e.target.value })}
        />
      </div>

      {/* Tours */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Tours de négociation</h4>
          <button type="button" className={BOUTON} onClick={ajouterTour}><IconPlus size={12} /> Nouveau tour</button>
        </div>
        {tours.length === 0 && <p className="text-[0.6875rem] italic text-[var(--tblr-muted)]">Aucun tour. Ajoutez la contre-proposition de l'entreprise à chaque échange.</p>}
        {tours.map((t, i) => (
          <div key={t.id} className="rounded-lg p-3 space-y-2" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold">Tour {i + 1}</span>
              <input type="date" aria-label={`Date du tour ${i + 1}`} className={CHAMP} value={t.date} onChange={e => majTour(t.id, { date: e.target.value })} />
              <input aria-label={`Intervenant du tour ${i + 1}`} className={cn(CHAMP, 'w-44')} placeholder="Interlocuteur" value={t.auteur ?? ''} onChange={e => majTour(t.id, { auteur: e.target.value })} />
              <label className="inline-flex items-center gap-1.5 text-xs font-medium">
                <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={!!t.finale} onChange={e => majTour(t.id, { finale: e.target.checked })} />
                Offre finale
              </label>
              <button type="button" aria-label={`Supprimer le tour ${i + 1}`} className="ml-auto p-1.5 text-zinc-400 hover:text-red-500"
                onClick={() => maj({ ...courante, tours: courante.tours.filter(x => x.id !== t.id) })}>
                <IconTrash size={14} />
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {cles.map(cle => (
                <label key={cle} className="flex flex-col gap-1 text-[0.6875rem] text-[var(--tblr-muted)]">
                  {libelle(cle)}
                  <NumInput
                    label={`${libelle(cle)}, tour ${i + 1}`} value={t.montants[cle]}
                    placeholder="inchangé" onChange={v => majMontantTour(t.id, cle, v)}
                  />
                </label>
              ))}
            </div>
            <input aria-label={`Remarque du tour ${i + 1}`} className={cn(CHAMP, 'w-full')} placeholder="Remarque (arguments, concessions, pièces demandées)"
              value={t.remarque ?? ''} onChange={e => majTour(t.id, { remarque: e.target.value })} />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={BOUTON} onClick={onPdf}><IconDownload size={12} /> Fiche PDF</button>
        <button type="button" className={BOUTON} onClick={() => maj({ ...courante, ecartee: !courante.ecartee })}>
          <IconBan size={12} /> {courante.ecartee ? 'Remettre dans la négociation' : 'Écarter de la négociation'}
        </button>
      </div>
    </div>
  );
}
