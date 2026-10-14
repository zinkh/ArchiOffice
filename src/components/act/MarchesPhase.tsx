import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IconChevronDown, IconDownload, IconFileDescription, IconGavel, IconLoader2, IconSignature, IconAlertTriangle, IconCheck,
} from '@tabler/icons-react';
import type { Contact, ProjectLot } from '../../types';
import type { DPGF, OffreDocument } from '../../types/dpgf';
import { cn } from '../../lib/utils';
import { apiFetch } from '../../lib/api';
import { getAccessToken } from '../../lib/authToken';
import { fetchAgencySettings } from '../../lib/pdfLetterhead';
import { PARAMETRES_MARCHE_DEFAUT, construireCCAP, type ContexteMarche, type ParametresMarche } from '../../lib/actMarche';
import { exporterMarcheDocx, exporterMarchePdf } from '../../lib/actMarcheExport';
import { genererActeFormulaire } from '../../lib/actEngagementForm';
import { exportCctpPdf } from '../../lib/cctpExport';
import { exportDPGFtoPDF } from '../../lib/proExport';
import { filtrerPourExport } from '../../lib/exportPerimetre';
import { livrer, telecharger, type FichierExporte, type Sortie } from '../../lib/exportSortie';
import { PARAMETRES_DEFAUT, parametresDe, type DonneesNegociation } from '../../lib/actNegociation';
import {
  LIBELLE_STATUT, aConstituer, dpgfDuMarche, lignesMarches, marcheACreer, nomPiece, snapshotOffre,
  trouverLotDocument, trouverOffre, valeursActe,
  type AttributionLue, type EntrepriseConsultee, type LigneMarche, type MarcheActLu, type ModeSignature, type StatutSignature,
} from '../../lib/marcheAct';
import type { OperationMarche } from './MarcheDocumentsPanel';

interface ConsultationLue extends DonneesNegociation {
  marche?: ParametresMarche;
  attributions: AttributionLue[];
  entreprises: EntrepriseConsultee[];
}

interface Props {
  projectId: string;
  projectName: string;
  lots: ProjectLot[];
  contacts: Contact[];
  consultation: ConsultationLue;
  operation: OperationMarche;
}

type Piece = 'cctp' | 'dpgf' | 'acte';

const BOUTON = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50';
const BOUTON_PRIMAIRE = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--tblr-primary)] text-white hover:opacity-90 disabled:opacity-50';
const CHAMP = 'w-full h-10 text-sm px-3 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500';

const euros = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

const PASTILLE: Record<StatutSignature, string> = {
  a_constituer: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  a_signer: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  signe: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

/** Collecte le fichier produit par un exporteur au lieu de le télécharger. */
function collecteur(): { sortie: Sortie; fichiers: FichierExporte[] } {
  const fichiers: FichierExporte[] = [];
  return { fichiers, sortie: (nom, blob) => { fichiers.push({ nom, blob }); } };
}

export default function MarchesPhase({ projectId, projectName, lots, contacts, consultation, operation }: Props) {
  const [marches, setMarches] = useState<MarcheActLu[]>([]);
  const [dpgf, setDpgf] = useState<DPGF | null>(null);
  const [offres, setOffres] = useState<OffreDocument[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [rouvrir, setRouvrir] = useState<string | null>(null);
  const [signature, setSignature] = useState<Record<string, { mode: ModeSignature; date: string; fichier: File | null }>>({});

  const tvaPct = parametresDe(consultation).tva_pct ?? PARAMETRES_DEFAUT.tva_pct;

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const [m, d, o] = await Promise.all([
        apiFetch<MarcheActLu[]>(`/api/marches-entreprises/${encodeURIComponent(projectId)}`),
        // Pas de DPGF : 404, ce n'est pas une panne.
        apiFetch<DPGF>(`/api/projects/${encodeURIComponent(projectId)}/dpgf`).catch(() => null),
        apiFetch<OffreDocument[]>(`/api/projects/${encodeURIComponent(projectId)}/dpgf/offres`).catch(() => []),
      ]);
      setMarches(m ?? []);
      setDpgf(d);
      setOffres(o ?? []);
    } catch (e: any) {
      setErreur(e?.message || 'Impossible de charger les marchés.');
    } finally {
      setChargement(false);
    }
  }, [projectId]);

  useEffect(() => { void charger(); }, [charger]);

  const lignes = useMemo(
    () => lignesMarches(consultation.attributions ?? [], consultation.entreprises ?? [], lots, marches),
    [consultation.attributions, consultation.entreprises, lots, marches],
  );
  const aFaire = lignes.filter(aConstituer);

  const parametres = { ...PARAMETRES_MARCHE_DEFAUT, ...(consultation.marche ?? {}) } as ParametresMarche;
  const contexte = (agence: { nom?: string; adresse?: string }): ContexteMarche => ({
    operation: { nom: operation.nom, code: operation.code, adresse: operation.adresse },
    params: {
      ...parametres,
      moa_nom: parametres.moa_nom || operation.maitreOuvrage,
      lieu_construction: parametres.lieu_construction || operation.adresse,
      permis_numero: parametres.permis_numero || operation.permisNumero,
      permis_date: parametres.permis_date || operation.permisDate,
    },
    agence,
  });
  const referenceOperation = operation.code || operation.nom;

  const executer = async (cle: string, action: () => Promise<void>) => {
    setErreur(null);
    setInfo(null);
    setEnCours(cle);
    try { await action(); }
    catch (e: any) { console.error(e); setErreur(e?.message || 'L\'opération a échoué.'); }
    finally { setEnCours(null); }
  };

  // ── Constitution ───────────────────────────────────────────────────────────

  const constituer = (cibles: LigneMarche[]) => executer('constituer', async () => {
    const payload = cibles.map(l => {
      const offre = trouverOffre(offres, l.entreprise);
      const lotDoc = trouverLotDocument(dpgf, l.lot);
      return marcheACreer(l, snapshotOffre(offre, lotDoc, l.entreprise, l.montant), tvaPct);
    });
    const res = await apiFetch<{ marches: MarcheActLu[]; crees: number; misAJour: number; ignores: number }>(
      `/api/projects/${encodeURIComponent(projectId)}/marches-act`,
      { method: 'POST', body: JSON.stringify({ marches: payload }) },
    );
    setMarches(res.marches);
    const morceaux = [res.crees && `${res.crees} marché${res.crees > 1 ? 's' : ''} constitué${res.crees > 1 ? 's' : ''}`, res.misAJour && `${res.misAJour} mis à jour`].filter(Boolean);
    setInfo(morceaux.join(', ') || 'Rien à constituer.');
  });

  // ── Pièces ─────────────────────────────────────────────────────────────────

  const produireCcap = async (format: 'pdf' | 'docx', sortie?: Sortie) => {
    const settings = await fetchAgencySettings();
    const docs = [construireCCAP(contexte({ nom: settings.agencyName, adresse: settings.address }))];
    const nom = nomPiece('CCAP', referenceOperation, undefined, undefined, format).replace(/\.\w+$/, '');
    if (format === 'pdf') await exporterMarchePdf(docs, settings, nom, sortie);
    else await exporterMarcheDocx(docs, settings, nom, sortie);
  };

  /** Une pièce du marché, sous forme d'un fichier nommé. */
  const produirePiece = async (piece: Piece, l: LigneMarche): Promise<FichierExporte> => {
    const marche = l.marche!;
    const settings = await fetchAgencySettings();
    const lot = { numero: l.lot.lot_number };
    const nom = (p: 'CCTP' | 'DPGF' | 'Acte_engagement') => nomPiece(p, referenceOperation, lot, marche.entreprise_nom);

    if (piece === 'acte') {
      const contact = contacts.find(c => c.id === marche.contact_id);
      const data = await genererActeFormulaire(
        contexte({ nom: settings.agencyName, adresse: settings.address }),
        [{ numero: l.lot.lot_number, titre: l.lot.lot_title }],
        marche.tva_rate ?? tvaPct, settings,
        valeursActe(contact, l.entreprise, lot, marche.montant_ht, marche.tva_rate ?? tvaPct),
      );
      return { nom: nom('Acte_engagement'), blob: new Blob([data], { type: 'application/pdf' }) };
    }

    if (!dpgf) throw new Error('Aucun DPGF dans l\'onglet PRO de l\'affaire : le CCTP et le DPGF du lot n\'ont pas de source.');
    const { sortie, fichiers } = collecteur();

    if (piece === 'cctp') {
      const source = filtrerPourExport(dpgf, { lotNumeros: [l.lot.lot_number], batimentCodes: null, phaseCodes: null }, { cctp: true });
      if (source.lots.length === 0) throw new Error(`Le lot ${l.lot.lot_number} est introuvable dans le CCTP.`);
      await exportCctpPdf(source, {
        projectName: `${projectName} - Lot ${l.lot.lot_number}`, settings, sortie,
        contexte: { operation: projectName, agence: settings.agencyName, adresse: operation.adresse, maitreOuvrage: operation.maitreOuvrage, reference: operation.code },
      });
    } else {
      const { dpgf: doc } = dpgfDuMarche(dpgf, l.lot.lot_number, marche.offre_snapshot);
      if (doc.lots.length === 0) throw new Error(`Le lot ${l.lot.lot_number} est introuvable dans le DPGF.`);
      await exportDPGFtoPDF(doc, `${projectName} - Lot ${l.lot.lot_number} - ${marche.entreprise_nom}`, 'lot', settings, { avecPrix: true, sortie });
    }
    if (!fichiers[0]) throw new Error('La pièce n\'a pas pu être produite.');
    return { nom: nom(piece === 'cctp' ? 'CCTP' : 'DPGF'), blob: fichiers[0].blob };
  };

  const telechargerPiece = (piece: Piece, l: LigneMarche) => executer(`${l.lot.id}-${piece}`, async () => {
    const f = await produirePiece(piece, l);
    await telecharger(f.nom, f.blob);
  });

  /** Les quatre pièces, chacune dans son fichier, réunies dans une archive. */
  const telechargerTout = (l: LigneMarche) => executer(`${l.lot.id}-tout`, async () => {
    const ccap = collecteur();
    await produireCcap('pdf', ccap.sortie);
    const pieces: FichierExporte[] = [
      { nom: nomPiece('CCAP', referenceOperation), blob: ccap.fichiers[0].blob },
      await produirePiece('cctp', l),
      await produirePiece('dpgf', l),
      await produirePiece('acte', l),
    ];
    await livrer(pieces, nomPiece('Marche', referenceOperation, { numero: l.lot.lot_number }, l.marche!.entreprise_nom, 'zip'));
  });

  // ── Signature ──────────────────────────────────────────────────────────────

  const etatSignature = (id: string) => signature[id] ?? { mode: 'papier' as ModeSignature, date: new Date().toISOString().slice(0, 10), fichier: null };
  const majSignature = (id: string, patch: Partial<{ mode: ModeSignature; date: string; fichier: File | null }>) =>
    setSignature(s => ({ ...s, [id]: { ...etatSignature(id), ...patch } }));

  const enregistrerSignature = (l: LigneMarche) => executer(`${l.lot.id}-signature`, async () => {
    const marche = l.marche!;
    const s = etatSignature(marche.id);
    if (!s.fichier) throw new Error('Déposez l\'acte d\'engagement signé (PDF ou image) pour enregistrer la signature.');
    const token = await getAccessToken();
    const form = new FormData();
    form.append('file', s.fichier);
    form.append('project_id', projectId);
    form.append('name', `Acte d'engagement signé - Lot ${l.lot.lot_number} - ${marche.entreprise_nom}`);
    form.append('category', 'Marchés');
    form.append('phase', 'ACT');
    form.append('description', `Signature ${s.mode === 'papier' ? 'papier' : 'électronique'} du ${s.date}`);
    form.append('uploaded_by', 'ACT');
    const depot = await fetch('/api/documents', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
    const doc = await depot.json().catch(() => ({}));
    if (!depot.ok) throw new Error(doc?.error || 'Le dépôt de l\'acte signé a échoué.');
    const maj = await apiFetch<MarcheActLu>(`/api/marches-entreprises/${encodeURIComponent(marche.id)}/signature`, {
      method: 'POST', body: JSON.stringify({ mode: s.mode, date_signature: s.date, document_id: doc.id }),
    });
    setMarches(ms => ms.map(m => (m.id === maj.id ? maj : m)));
    setInfo(`Marché du lot ${l.lot.lot_number} signé le ${s.date.split('-').reverse().join('/')}.`);
  });

  const rouvrirSignature = (l: LigneMarche) => executer(`${l.lot.id}-rouvrir`, async () => {
    const maj = await apiFetch<MarcheActLu>(`/api/marches-entreprises/${encodeURIComponent(l.marche!.id)}/signature/rouvrir`, { method: 'POST' });
    setMarches(ms => ms.map(m => (m.id === maj.id ? maj : m)));
    setRouvrir(null);
  });

  // ── Rendu ──────────────────────────────────────────────────────────────────

  const occupe = !!enCours;

  if (chargement) {
    return <div className="flex items-center gap-2 p-6 text-sm text-[var(--tblr-muted)]"><IconLoader2 size={16} className="animate-spin" /> Chargement des marchés…</div>;
  }

  return (
    <div className="space-y-6">
      {erreur && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm border" style={{ borderColor: 'var(--tblr-danger)', color: 'var(--tblr-danger)', background: 'var(--tblr-surface)' }}>
          <span className="flex items-start gap-2"><IconAlertTriangle size={16} className="mt-0.5 shrink-0" />{erreur}</span>
          <button type="button" className="font-bold underline shrink-0" onClick={() => void charger()}>Réessayer</button>
        </div>
      )}
      {info && !erreur && (
        <div role="status" className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm border border-[var(--tblr-border)]" style={{ background: 'var(--tblr-surface)' }}>
          <IconCheck size={16} className="text-green-600" />{info}
        </div>
      )}

      <div className="rounded-lg p-5 space-y-2" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-[var(--tblr-text)] flex items-center gap-2"><IconGavel size={16} /> Marchés de travaux</h3>
            <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-1">
              Un marché par lot attribué : CCAP de l'opération, CCTP du lot, DPGF aux prix de l'offre retenue (figés à la constitution) et acte d'engagement prérempli.
            </p>
          </div>
          <button type="button" className={BOUTON_PRIMAIRE} disabled={occupe || aFaire.length === 0} onClick={() => void constituer(aFaire)}>
            {enCours === 'constituer' ? <IconLoader2 size={14} className="animate-spin" /> : <IconFileDescription size={14} />}
            {aFaire.length === 0 ? 'Marchés à jour' : `Constituer ${aFaire.length === 1 ? 'le marché' : `les ${aFaire.length} marchés`}`}
          </button>
        </div>
      </div>

      <div className="rounded-lg p-5" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--tblr-text)]">CCAP de l'opération</p>
            <p className="text-[0.6875rem] text-[var(--tblr-muted)]">Commun à tous les marchés, il ne dépend d'aucune entreprise. Ses réglages sont dans la phase « Critères ».</p>
          </div>
          <div className="flex gap-2">
            {(['pdf', 'docx'] as const).map(f => (
              <button key={f} type="button" className={BOUTON} disabled={occupe} onClick={() => void executer(`ccap-${f}`, () => produireCcap(f))}>
                <IconDownload size={13} /> {enCours === `ccap-${f}` ? 'Génération…' : f === 'pdf' ? 'PDF' : 'Word'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {lignes.length === 0 ? (
        <div className="rounded-lg p-8 text-center text-sm text-[var(--tblr-muted)]" style={{ background: 'var(--tblr-surface)', border: '1px dashed var(--tblr-border)' }}>
          Aucun lot attribué. Attribuez les lots aux entreprises retenues dans la phase « Attribution », leurs marchés se constituent ici.
        </div>
      ) : (
        <ul className="space-y-3">
          {lignes.map(l => {
            const cle = l.lot.id;
            const marche = l.marche;
            const deplie = ouvert === cle;
            const sansOffre = marche && !marche.offre_snapshot;
            const sig = marche ? etatSignature(marche.id) : null;
            const signe = l.statut === 'signe';
            return (
              <li key={cle} className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                <button type="button" aria-expanded={deplie} disabled={!marche}
                  onClick={() => setOuvert(deplie ? null : cle)}
                  className="w-full flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left disabled:cursor-default">
                  <span className="px-2 py-0.5 rounded-lg bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)] text-[0.6875rem] font-black shrink-0">Lot {l.lot.lot_number}</span>
                  <span className="min-w-0 flex-1 basis-48">
                    <span className="block text-sm font-bold text-[var(--tblr-text)] truncate">{l.lot.lot_title}</span>
                    <span className="block text-xs text-[var(--tblr-muted)] truncate">{l.entreprise.nom}</span>
                  </span>
                  <span className="text-sm font-bold text-[var(--tblr-text)] tabular-nums">{euros(marche?.montant_ht ?? l.montant)} HT</span>
                  <span className={cn('text-[0.6875rem] px-2 py-0.5 rounded-full font-bold', PASTILLE[l.statut])}>{LIBELLE_STATUT[l.statut]}</span>
                  {marche && <IconChevronDown size={16} className={cn('text-[var(--tblr-muted)] transition-transform', deplie && 'rotate-180')} aria-hidden />}
                </button>

                {l.ecart !== null && (
                  <div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40">
                    <span>
                      L'attribution est de {euros(l.montant)} HT, le marché enregistré de {euros(marche!.montant_ht)} HT ({l.ecart > 0 ? '+' : ''}{euros(l.ecart)}).
                      {signe && ' Le marché est signé : il n\'est pas modifié.'}
                    </span>
                    {!signe && <button type="button" className="font-bold underline" disabled={occupe} onClick={() => void constituer([l])}>Mettre le marché à jour</button>}
                  </div>
                )}

                {marche && deplie && (
                  <div className="border-t border-[var(--tblr-border)] p-4 space-y-5">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <p className="text-xs font-bold uppercase tracking-wide text-[var(--tblr-muted)]">Pièces du marché</p>
                        <button type="button" className={BOUTON} disabled={occupe} onClick={() => void telechargerTout(l)}>
                          {enCours === `${cle}-tout` ? <IconLoader2 size={13} className="animate-spin" /> : <IconDownload size={13} />} Les 4 pièces (archive)
                        </button>
                      </div>
                      {sansOffre && (
                        <p className="mb-2 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                          <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
                          Aucune offre chiffrée de cette entreprise dans le DPGF : le DPGF du marché sera sans prix. Importez son offre dans l'onglet PRO, puis mettez le marché à jour.
                        </p>
                      )}
                      <ul className="grid gap-2 sm:grid-cols-2">
                        <li className="flex items-center justify-between gap-2 rounded-lg border border-[var(--tblr-border)] px-3 py-2">
                          <span className="text-sm">CCAP <span className="text-[0.6875rem] text-[var(--tblr-muted)]">(opération)</span></span>
                          <button type="button" className={BOUTON} disabled={occupe} onClick={() => void executer(`${cle}-ccap`, () => produireCcap('pdf'))}><IconDownload size={13} /> PDF</button>
                        </li>
                        {([['cctp', 'CCTP', 'extrait du lot'], ['dpgf', 'DPGF', 'prix de l\'offre'], ['acte', 'Acte d\'engagement', 'prérempli']] as const).map(([piece, titre, aide]) => (
                          <li key={piece} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--tblr-border)] px-3 py-2">
                            <span className="text-sm">{titre} <span className="text-[0.6875rem] text-[var(--tblr-muted)]">({aide})</span></span>
                            <button type="button" className={BOUTON} disabled={occupe} onClick={() => void telechargerPiece(piece, l)}>
                              {enCours === `${cle}-${piece}` ? <IconLoader2 size={13} className="animate-spin" /> : <IconDownload size={13} />} PDF
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-[var(--tblr-muted)] mb-2 flex items-center gap-1.5"><IconSignature size={14} /> Signature</p>
                      {signe ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                          <span>
                            Signé le {marche.date_signature?.split('-').reverse().join('/')}, par voie {marche.mode_signature === 'electronique' ? 'électronique' : 'papier'}.
                            L'acte signé est dans les documents de l'affaire (catégorie « Marchés »).
                          </span>
                          {rouvrir === cle ? (
                            <span className="flex items-center gap-2">
                              <button type="button" className={BOUTON} onClick={() => setRouvrir(null)}>Annuler</button>
                              <button type="button" className={BOUTON_PRIMAIRE} disabled={occupe} onClick={() => void rouvrirSignature(l)}>Confirmer la réouverture</button>
                            </span>
                          ) : (
                            <button type="button" className={BOUTON} onClick={() => setRouvrir(cle)}>Rouvrir la signature</button>
                          )}
                        </div>
                      ) : sig && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <fieldset className="md:col-span-2 flex flex-wrap gap-4 text-sm">
                            <legend className="sr-only">Mode de signature</legend>
                            {([['papier', 'Papier (dépôt du scan)'], ['electronique', 'Électronique (dépôt du document signé)']] as const).map(([mode, libelle]) => (
                              <label key={mode} className="flex items-center gap-2">
                                <input type="radio" name={`mode-${marche.id}`} checked={sig.mode === mode} onChange={() => majSignature(marche.id, { mode })} />
                                {libelle}
                              </label>
                            ))}
                          </fieldset>
                          {sig.mode === 'electronique' && (
                            <p className="md:col-span-2 text-[0.6875rem] text-[var(--tblr-muted)]">
                              Aucun service de signature électronique n'est connecté à ArchiOffice : faites signer l'acte avec votre outil habituel, puis déposez ici le PDF signé, qui garde sa preuve de signature.
                            </p>
                          )}
                          <label className="block">
                            <span className="block text-[0.6875rem] font-semibold text-[var(--tblr-muted)] mb-1">Date de signature</span>
                            <input type="date" className={CHAMP} style={{ minWidth: 0, WebkitAppearance: 'none', appearance: 'none' }} value={sig.date} onChange={e => majSignature(marche.id, { date: e.target.value })} />
                          </label>
                          <label className="block">
                            <span className="block text-[0.6875rem] font-semibold text-[var(--tblr-muted)] mb-1">Acte d'engagement signé</span>
                            <input type="file" accept="application/pdf,image/*" className={cn(CHAMP, 'py-2 h-auto')} onChange={e => majSignature(marche.id, { fichier: e.target.files?.[0] ?? null })} />
                          </label>
                          <div className="md:col-span-2 flex justify-end">
                            <button type="button" className={BOUTON_PRIMAIRE} disabled={occupe || !sig.fichier || !sig.date} onClick={() => void enregistrerSignature(l)}>
                              {enCours === `${cle}-signature` ? <IconLoader2 size={13} className="animate-spin" /> : <IconSignature size={13} />} Enregistrer la signature
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
