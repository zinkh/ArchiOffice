import React, { useMemo, useState } from 'react';
import {
  IconSearch, IconSend, IconTrash, IconPlus, IconAlertTriangle, IconX, IconUserPlus,
} from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { groupByLot } from '../lib/actExport';
import {
  type EntrepriseSuivi, type StatutEntreprise, type FiltresEntreprises,
  STATUT_LABELS, STATUT_ORDER, SANS_LOT, MIN_ENTREPRISES_PAR_LOT, FILTRES_VIDES,
  statutEntreprise, resumeSuivi, couverture, suggererContacts, filtrerEntreprises,
  filtresActifs, nomContact, todayIso,
} from '../lib/actEntreprises';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useMailAccounts } from '../hooks/useMailAccounts';
import type { Contact, ProjectLot } from '../types';
import { EntrepriseAutocomplete } from './EntrepriseAutocomplete';
import { MultiSelectDropdown, type MultiSelectOption } from './MultiSelectDropdown';
import MailComposeModal from './MailComposeModal';

export type EntrepriseRow = EntrepriseSuivi & { corps_etat_codes?: string[] };

/** Une pièce du DCE, déjà libellée, avec les lots qu'elle concerne. */
export interface PieceDce {
  libelle: string;
  tous_lots: boolean;
  lots_ids: string[];
}

interface Props {
  projectName: string;
  lots: ProjectLot[];
  entreprises: EntrepriseRow[];
  onChange: (next: EntrepriseRow[]) => void;
  dcePieces: PieceDce[];
  entrepriseContacts: Contact[];
  corpsEtatOptions: MultiSelectOption[];
  lotOptions: MultiSelectOption[];
  onChangeCorpsEtat: (e: EntrepriseRow, next: string[]) => void;
  onSelectContact: (rowId: string, contact: Contact) => void;
  onCreateContact: (rowId: string, name: string) => void;
  corpsEtatCodesFromContact: (contact: Contact) => string[];
}

const PILL: Record<StatutEntreprise, string> = {
  a_envoyer: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  dce_envoye: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  a_relancer: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  offre_recue: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  sans_reponse: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  hors_envoi: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

const STATUT_OPTIONS: MultiSelectOption[] = [
  { value: 'envoyer_dce', label: 'DCE à envoyer' },
  { value: 'ne_repond_pas', label: 'Ne répond pas' },
];

const FIELD = 'text-xs border border-[var(--tblr-border)] rounded-lg px-2 py-1.5 bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500';
const TH = 'px-3 py-2.5 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]';

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');

// ── Envoi du DCE par mail ────────────────────────────────────────────────────
// Les comptes mail ne sont lus qu'à l'ouverture, pas à chaque affichage du tableau.

function DceMailDialog({ projectName, entreprise, lots, pieces, onSent, onClose }: {
  projectName: string;
  entreprise: EntrepriseRow;
  lots: ProjectLot[];
  pieces: PieceDce[];
  onSent: () => void;
  onClose: () => void;
}) {
  const { accounts, loading } = useMailAccounts();
  if (loading) return null;

  const lotsEntreprise = lots.filter(l => entreprise.lots_ids.includes(l.id));
  const piecesEntreprise = pieces.filter(p => p.tous_lots || p.lots_ids.some(id => entreprise.lots_ids.includes(id)));
  const libelleLots = lotsEntreprise.map(l => `Lot ${l.lot_number} — ${l.lot_title}`);
  const body = [
    'Bonjour,',
    '',
    `Dans le cadre de la consultation des entreprises pour l'opération « ${projectName} », nous vous transmettons le dossier de consultation (DCE)${libelleLots.length ? ` relatif à :\n${libelleLots.map(l => `- ${l}`).join('\n')}` : '.'}`,
    ...(piecesEntreprise.length ? ['', 'Pièces du dossier :', ...piecesEntreprise.map(p => `- ${p.libelle}`)] : []),
    '',
    'Nous restons à votre disposition pour toute précision.',
    '',
    'Cordialement,',
  ].join('\n');
  const lotsCourts = lotsEntreprise.map(l => `Lot ${l.lot_number}`).join(', ');

  return (
    <MailComposeModal
      accounts={accounts}
      initial={{
        to: entreprise.email || '',
        subject: `Consultation des entreprises — ${projectName}${lotsCourts ? ` — ${lotsCourts}` : ''}`,
        body,
      }}
      onSent={onSent}
      onClose={onClose}
    />
  );
}

// ── Tableau ──────────────────────────────────────────────────────────────────

export default function ACTEntreprisesTable({
  projectName, lots, entreprises, onChange, dcePieces, entrepriseContacts,
  corpsEtatOptions, lotOptions, onChangeCorpsEtat, onSelectContact, onCreateContact,
  corpsEtatCodesFromContact,
}: Props) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const today = todayIso();

  const [filtres, setFiltres] = useState<FiltresEntreprises>(FILTRES_VIDES);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [suggestLotId, setSuggestLotId] = useState<string | null>(null);
  const [mailPour, setMailPour] = useState<string | null>(null);

  const patch = (id: string, p: Partial<EntrepriseRow>) =>
    onChange(entreprises.map(e => (e.id === id ? { ...e, ...p } : e)));
  const patchMany = (ids: Set<string>, p: (e: EntrepriseRow) => Partial<EntrepriseRow>) =>
    onChange(entreprises.map(e => (ids.has(e.id) ? { ...e, ...p(e) } : e)));

  const resume = useMemo(() => resumeSuivi(entreprises, today), [entreprises, today]);
  const couv = useMemo(() => couverture(entreprises, lots), [entreprises, lots]);

  const groupes = useMemo(() => {
    const filtrees = filtrerEntreprises(entreprises, filtres, today);
    const tous = groupByLot(filtrees, lots);
    return filtres.lot ? tous.filter(g => g.key === filtres.lot) : tous;
  }, [entreprises, filtres, lots, today]);

  const idsAffiches = useMemo(() => new Set(groupes.flatMap(g => g.entreprises.map(e => e.id))), [groupes]);
  const nbAffichees = idsAffiches.size;
  const selectionActive = useMemo(
    () => new Set([...selection].filter(id => entreprises.some(e => e.id === id))),
    [selection, entreprises],
  );
  const toutSelectionne = nbAffichees > 0 && [...idsAffiches].every(id => selectionActive.has(id));

  const toggleSelection = (id: string) =>
    setSelection(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleTout = () => setSelection(toutSelectionne ? new Set() : new Set(idsAffiches));

  const ajouterSurLot = (lotId: string, contact?: Contact) => {
    const e: EntrepriseRow = contact
      ? {
          id: crypto.randomUUID(), contact_id: contact.id, nom: nomContact(contact),
          email: contact.email_work || contact.email || '', lots_ids: [lotId], envoyer_dce: true,
          corps_etat_codes: corpsEtatCodesFromContact(contact),
        }
      : { id: crypto.randomUUID(), nom: '', lots_ids: [lotId], envoyer_dce: true };
    onChange([...entreprises, e]);
  };

  const supprimer = (ids: Set<string>) => {
    const noms = entreprises.filter(e => ids.has(e.id)).map(e => e.nom || 'sans nom');
    const message = ids.size === 1
      ? `Retirer « ${noms[0]} » de la consultation ?`
      : `Retirer ${ids.size} entreprises de la consultation ?`;
    if (!window.confirm(message)) return;
    onChange(entreprises.filter(e => !ids.has(e.id)));
    setSelection(prev => new Set([...prev].filter(id => !ids.has(id))));
  };

  const entrepriseMail = mailPour ? entreprises.find(e => e.id === mailPour) : undefined;
  const lotSuggestion = suggestLotId ? lots.find(l => l.id === suggestLotId) : undefined;
  const suggestions = useMemo(
    () => lotSuggestion
      ? suggererContacts(lotSuggestion, entrepriseContacts, new Set(entreprises.map(e => e.contact_id).filter((x): x is string => !!x)))
      : [],
    [lotSuggestion, entrepriseContacts, entreprises],
  );

  // ── Champs communs au tableau et aux cartes mobiles ────────────────────────

  const champNom = (e: EntrepriseRow) => (
    <>
      <EntrepriseAutocomplete
        contacts={entrepriseContacts}
        contactId={e.contact_id}
        fallbackName={e.nom}
        onSelect={c => onSelectContact(e.id, c)}
        onCreate={name => onCreateContact(e.id, name)}
      />
      <input
        className="mt-1 w-full text-[0.6875rem] border border-transparent hover:border-[var(--tblr-border)] focus:border-[var(--tblr-border)] rounded-md px-2 py-1 bg-transparent text-[var(--tblr-muted)] outline-none"
        type="email" aria-label="Email de l'entreprise"
        placeholder="email@entreprise.fr" value={e.email || ''}
        onChange={ev => patch(e.id, { email: ev.target.value })}
      />
    </>
  );

  const champCorps = (e: EntrepriseRow) => (
    <MultiSelectDropdown
      options={corpsEtatOptions} selected={e.corps_etat_codes || []}
      onChange={next => onChangeCorpsEtat(e, next)}
      placeholder="Non classé" maxChips={1} tone="green" searchable
      ariaLabel={`Corps d'état de ${e.nom || "l'entreprise"}`}
    />
  );

  const champLots = (e: EntrepriseRow) => (
    <MultiSelectDropdown
      options={lotOptions} selected={e.lots_ids}
      onChange={next => patch(e.id, { lots_ids: next })}
      placeholder="Aucun lot" maxChips={3} tone="blue" bulkActions
      ariaLabel={`Lots de ${e.nom || "l'entreprise"}`}
    />
  );

  const champDates = (e: EntrepriseRow) => {
    const ligne = (label: string, cle: 'dce_transmis_le' | 'relance_le' | 'offre_recue_le') => (
      <label className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">{label}</span>
        <input type="date" aria-label={`${label} : ${e.nom || "l'entreprise"}`}
          className={cn(FIELD, 'py-1 flex-1 min-w-0 md:w-[8.5rem] md:flex-none')}
          value={e[cle] || ''} onChange={ev => patch(e.id, { [cle]: ev.target.value || undefined })} />
      </label>
    );
    return (
      <div className="flex flex-col gap-1">
        {ligne('DCE', 'dce_transmis_le')}
        {ligne('Relance', 'relance_le')}
        {ligne('Offre', 'offre_recue_le')}
      </div>
    );
  };

  const champStatut = (e: EntrepriseRow) => {
    const statut = statutEntreprise(e, today);
    const coches = [e.envoyer_dce && 'envoyer_dce', e.ne_repond_pas && 'ne_repond_pas'].filter((x): x is string => !!x);
    return (
      <MultiSelectDropdown
        options={STATUT_OPTIONS} selected={coches}
        onChange={next => patch(e.id, { envoyer_dce: next.includes('envoyer_dce'), ne_repond_pas: next.includes('ne_repond_pas') })}
        placeholder="" menuMinWidth={200}
        ariaLabel={`Statut de ${e.nom || "l'entreprise"} : ${STATUT_LABELS[statut]}`}
        triggerContent={
          <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-[0.6875rem] font-bold whitespace-nowrap', PILL[statut])}>
            {STATUT_LABELS[statut]}
          </span>
        }
      />
    );
  };

  const boutonsLigne = (e: EntrepriseRow) => (
    <div className="flex items-center gap-0.5">
      <button
        type="button" onClick={() => setMailPour(e.id)} disabled={!(e.email || '').trim()}
        title={(e.email || '').trim() ? 'Envoyer le DCE par mail' : "Renseignez l'email pour envoyer le DCE"}
        aria-label={`Envoyer le DCE à ${e.nom || "l'entreprise"}`}
        className="p-1.5 rounded-md text-zinc-400 hover:text-blue-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:text-zinc-400 disabled:hover:bg-transparent"
      ><IconSend size={14} /></button>
      <button
        type="button" onClick={() => supprimer(new Set([e.id]))}
        aria-label={`Retirer ${e.nom || "l'entreprise"}`}
        className="p-1.5 rounded-md text-zinc-300 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      ><IconTrash size={14} /></button>
    </div>
  );

  const caseSelection = (e: EntrepriseRow) => (
    <input
      type="checkbox" className="w-4 h-4 rounded accent-blue-600 shrink-0"
      checked={selectionActive.has(e.id)} onChange={() => toggleSelection(e.id)}
      aria-label={`Sélectionner ${e.nom || "l'entreprise"}`}
    />
  );

  // ── Rendu ──────────────────────────────────────────────────────────────────

  const nbCols = 7;
  const aucuneEntreprise = entreprises.length === 0;
  const pctOffres = resume.total ? Math.round((resume.parStatut.offre_recue / resume.total) * 100) : 0;

  return (
    <div>
      {/* Synthèse du suivi */}
      {!aucuneEntreprise && (
        <div className="px-5 py-3 border-b border-[var(--tblr-border)] space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-sm font-bold text-[var(--tblr-text)]">
              {resume.parStatut.offre_recue} offre{resume.parStatut.offre_recue > 1 ? 's' : ''} reçue{resume.parStatut.offre_recue > 1 ? 's' : ''} sur {resume.total}
            </p>
            <div className="flex-1 min-w-[80px] max-w-[220px] h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden" role="progressbar"
              aria-valuenow={pctOffres} aria-valuemin={0} aria-valuemax={100} aria-label="Offres reçues">
              <div className="h-full bg-emerald-500" style={{ width: `${pctOffres}%` }} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUT_ORDER.filter(s => resume.parStatut[s] > 0).map(s => (
                <button
                  key={s} type="button"
                  onClick={() => setFiltres(f => ({ ...f, statut: f.statut === s ? '' : s }))}
                  aria-pressed={filtres.statut === s}
                  className={cn(
                    'px-2 py-0.5 rounded-full text-[0.6875rem] font-bold transition',
                    PILL[s], filtres.statut === s && 'ring-2 ring-offset-1 ring-blue-500',
                  )}
                >
                  {resume.parStatut[s]} {STATUT_LABELS[s].toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Alertes de couverture */}
          {(couv.lotsInsuffisants.length > 0 || couv.sansLot.length > 0 || couv.sansEmail.length > 0) && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
              <IconAlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1.5 min-w-0">
                {couv.lotsInsuffisants.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>Moins de {MIN_ENTREPRISES_PAR_LOT} entreprises consultées :</span>
                    {couv.lotsInsuffisants.map(({ lot, nb }) => (
                      <button
                        key={lot.id} type="button"
                        onClick={() => setSuggestLotId(id => (id === lot.id ? null : lot.id))}
                        aria-expanded={suggestLotId === lot.id}
                        className={cn(
                          'px-2 py-0.5 rounded-full font-bold border transition',
                          suggestLotId === lot.id
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-white dark:bg-zinc-900 border-amber-300 dark:border-amber-700 hover:bg-amber-100',
                        )}
                      >
                        Lot {lot.lot_number} · {nb}/{MIN_ENTREPRISES_PAR_LOT}
                      </button>
                    ))}
                  </div>
                )}
                {couv.sansLot.length > 0 && (
                  <p>
                    <button type="button" className="font-bold underline" onClick={() => setFiltres(f => ({ ...f, lot: SANS_LOT }))}>
                      {couv.sansLot.length} entreprise{couv.sansLot.length > 1 ? 's' : ''} sans lot
                    </button>
                    {' '}: elle{couv.sansLot.length > 1 ? 's ne recevront' : ' ne recevra'} aucun DCE ciblé.
                  </p>
                )}
                {couv.sansEmail.length > 0 && (
                  <p title={couv.sansEmail.map(e => e.nom || 'sans nom').join(', ')}>
                    <span className="font-bold">{couv.sansEmail.length} entreprise{couv.sansEmail.length > 1 ? 's' : ''} sans email</span>
                    {' '}alors que le DCE est à envoyer.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Suggestions pour un lot sous-couvert */}
          {lotSuggestion && (
            <div className="rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)] p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-bold text-[var(--tblr-text)]">
                  Entreprises suggérées pour Lot {lotSuggestion.lot_number} — {lotSuggestion.lot_title}
                </p>
                <button type="button" onClick={() => setSuggestLotId(null)} aria-label="Fermer les suggestions" className="p-1 text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]"><IconX size={13} /></button>
              </div>
              {suggestions.length > 0 ? (
                <ul className="grid sm:grid-cols-2 gap-1.5">
                  {suggestions.map(c => (
                    <li key={c.id} className="flex items-center justify-between gap-2 rounded-md bg-[var(--tblr-surface)] border border-[var(--tblr-border)] px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{nomContact(c)}</p>
                        <p className="text-[0.6875rem] text-[var(--tblr-muted)] truncate">{(c.corps_etat || []).join(', ')}</p>
                      </div>
                      <button type="button" onClick={() => ajouterSurLot(lotSuggestion.id, c)}
                        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[0.6875rem] font-bold bg-blue-600 text-white hover:bg-blue-700">
                        <IconUserPlus size={12} /> Ajouter
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--tblr-muted)] italic">
                  Aucun contact « Entreprise » dont le corps d'état recoupe ce lot. Renseignez les corps d'état sur les fiches contacts pour obtenir des suggestions.
                </p>
              )}
              <div className="mt-2 flex items-center gap-3">
                <button type="button" onClick={() => ajouterSurLot(lotSuggestion.id)} className="text-[0.6875rem] font-bold text-blue-600 hover:underline flex items-center gap-1">
                  <IconPlus size={11} /> Ajouter une ligne vide sur ce lot
                </button>
                <button type="button" onClick={() => setFiltres(f => ({ ...f, lot: lotSuggestion.id }))} className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] hover:underline">
                  Filtrer le tableau sur ce lot
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filtres */}
      {!aucuneEntreprise && (
        <div className="px-5 py-3 border-b border-[var(--tblr-border)] flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <IconSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)]" />
            <input
              type="search" value={filtres.recherche} aria-label="Rechercher une entreprise"
              onChange={ev => setFiltres(f => ({ ...f, recherche: ev.target.value }))}
              placeholder="Rechercher (nom, email)…"
              className={cn(FIELD, 'w-full pl-7')}
            />
          </div>
          <select aria-label="Filtrer par lot" value={filtres.lot} onChange={ev => setFiltres(f => ({ ...f, lot: ev.target.value }))} className={FIELD}>
            <option value="">Tous les lots</option>
            {lots.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} — {l.lot_title}</option>)}
            <option value={SANS_LOT}>Sans lot</option>
          </select>
          <select aria-label="Filtrer par statut" value={filtres.statut} onChange={ev => setFiltres(f => ({ ...f, statut: ev.target.value as StatutEntreprise | '' }))} className={FIELD}>
            <option value="">Tous les statuts</option>
            {STATUT_ORDER.map(s => <option key={s} value={s}>{STATUT_LABELS[s]}</option>)}
          </select>
          {filtresActifs(filtres) && (
            <button type="button" onClick={() => setFiltres(FILTRES_VIDES)} className="text-xs font-bold text-blue-600 hover:underline">Réinitialiser</button>
          )}
          <span className="ml-auto text-[0.6875rem] text-[var(--tblr-muted)]">{nbAffichees} / {entreprises.length} entreprise{entreprises.length > 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Actions groupées */}
      {selectionActive.size > 0 && (
        <div className="px-5 py-2.5 border-b border-[var(--tblr-border)] bg-blue-50 dark:bg-blue-900/20 flex items-center gap-2 flex-wrap" role="toolbar" aria-label="Actions sur la sélection">
          <span className="text-xs font-bold text-blue-800 dark:text-blue-200">{selectionActive.size} sélectionnée{selectionActive.size > 1 ? 's' : ''}</span>
          <select aria-label="Ajouter la sélection à un lot" value="" className={FIELD}
            onChange={ev => { const id = ev.target.value; if (id) patchMany(selectionActive, e => ({ lots_ids: e.lots_ids.includes(id) ? e.lots_ids : [...e.lots_ids, id] })); }}>
            <option value="">Ajouter au lot…</option>
            {lots.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} — {l.lot_title}</option>)}
          </select>
          <select aria-label="Retirer la sélection d'un lot" value="" className={FIELD}
            onChange={ev => { const id = ev.target.value; if (id) patchMany(selectionActive, e => ({ lots_ids: e.lots_ids.filter(x => x !== id) })); }}>
            <option value="">Retirer du lot…</option>
            {lots.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} — {l.lot_title}</option>)}
          </select>
          <button type="button" className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] hover:bg-zinc-50"
            onClick={() => patchMany(selectionActive, e => ({ dce_transmis_le: e.dce_transmis_le || today, envoyer_dce: true, ne_repond_pas: false }))}>
            DCE transmis aujourd'hui
          </button>
          <label className="flex items-center gap-1.5 text-xs font-bold text-blue-800 dark:text-blue-200">
            Relance le
            <input type="date" aria-label="Date de relance de la sélection" value="" className={cn(FIELD, 'py-1')}
              onChange={ev => { const v = ev.target.value; if (v) patchMany(selectionActive, () => ({ relance_le: v })); }} />
          </label>
          <button type="button" className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] hover:bg-zinc-50"
            onClick={() => patchMany(selectionActive, () => ({ ne_repond_pas: true }))}>
            Ne répond pas
          </button>
          <button type="button" className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] hover:bg-red-50"
            onClick={() => supprimer(selectionActive)}>
            Retirer
          </button>
          <button type="button" className="ml-auto text-xs font-bold text-blue-800 dark:text-blue-200 hover:underline" onClick={() => setSelection(new Set())}>Tout désélectionner</button>
        </div>
      )}

      {/* Liste */}
      {isDesktop ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1060px]">
            <thead className="bg-[var(--tblr-surface-2)]">
              <tr>
                <th className={cn(TH, 'sticky left-0 z-[2] bg-[var(--tblr-surface-2)] min-w-[280px] w-[280px]')}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="w-4 h-4 rounded accent-blue-600" checked={toutSelectionne} onChange={toggleTout}
                      disabled={nbAffichees === 0} aria-label="Sélectionner toutes les entreprises affichées" />
                    Entreprise
                  </div>
                </th>
                <th className={cn(TH, 'min-w-[200px]')}>Corps d'état</th>
                <th className={cn(TH, 'min-w-[200px]')}>Lots assignés</th>
                <th className={cn(TH, 'min-w-[220px]')}>Suivi</th>
                <th className={cn(TH, 'min-w-[130px]')}>Statut</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--tblr-border)]">
              {groupes.map(groupe => (
                <React.Fragment key={groupe.key}>
                  <tr className="bg-zinc-100 dark:bg-zinc-800">
                    <td colSpan={nbCols - 1} className="px-4 py-1.5 text-[0.6875rem] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                      {groupe.libelle} <span className="font-bold text-[var(--tblr-muted)]">· {groupe.entreprises.length}</span>
                    </td>
                  </tr>
                  {groupe.entreprises.map(e => (
                    <tr key={`${e.id}::${groupe.key}`} className={cn('hover:bg-zinc-50 dark:hover:bg-zinc-800/30 align-top', e.ne_repond_pas && 'opacity-60')}>
                      <td className="px-3 py-2.5 sticky left-0 z-[1] bg-[var(--tblr-surface)] border-r border-[var(--tblr-border)]">
                        <div className="flex items-start gap-2">
                          <div className="pt-2">{caseSelection(e)}</div>
                          <div className="flex-1 min-w-0">{champNom(e)}</div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">{champCorps(e)}</td>
                      <td className="px-3 py-2.5">{champLots(e)}</td>
                      <td className="px-3 py-2.5">{champDates(e)}</td>
                      <td className="px-3 py-2.5 pt-3.5">{champStatut(e)}</td>
                      <td className="px-3 py-2.5 text-right">{boutonsLigne(e)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {groupes.length === 0 && (
                <tr><td colSpan={nbCols - 1} className="px-4 py-8 text-center text-[var(--tblr-muted)] italic text-sm">
                  {aucuneEntreprise ? 'Aucune entreprise consultée.' : 'Aucune entreprise ne correspond aux filtres.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-3 space-y-4">
          {groupes.map(groupe => (
            <section key={groupe.key} aria-label={groupe.libelle}>
              <h4 className="px-1 pb-1.5 text-[0.6875rem] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                {groupe.libelle} <span className="font-bold text-[var(--tblr-muted)]">· {groupe.entreprises.length}</span>
              </h4>
              <ul className="space-y-2.5">
                {groupe.entreprises.map(e => (
                  <li key={`${e.id}::${groupe.key}`}
                    className={cn('rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] p-3 space-y-2.5', e.ne_repond_pas && 'opacity-60')}>
                    <div className="flex items-start gap-2">
                      <div className="pt-2">{caseSelection(e)}</div>
                      <div className="flex-1 min-w-0">{champNom(e)}</div>
                      {boutonsLigne(e)}
                    </div>
                    <div className="flex items-center justify-between gap-2">{champStatut(e)}</div>
                    <div className="grid grid-cols-1 gap-2">
                      {champCorps(e)}
                      {champLots(e)}
                    </div>
                    {champDates(e)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {groupes.length === 0 && (
            <p className="px-4 py-8 text-center text-[var(--tblr-muted)] italic text-sm">
              {aucuneEntreprise ? 'Aucune entreprise consultée.' : 'Aucune entreprise ne correspond aux filtres.'}
            </p>
          )}
        </div>
      )}

      {entrepriseMail && (
        <DceMailDialog
          projectName={projectName} entreprise={entrepriseMail} lots={lots} pieces={dcePieces}
          onClose={() => setMailPour(null)}
          onSent={() => patch(entrepriseMail.id, {
            dce_transmis_le: entrepriseMail.dce_transmis_le || today, envoyer_dce: true, ne_repond_pas: false,
          })}
        />
      )}
    </div>
  );
}
