import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUser } from '../UserContext';
import { useSettings } from '../hooks/useSettings';
import { apiFetch } from '../lib/api';
import {
  IconShieldCheck, IconPlus, IconEdit, IconTrash, IconDownload,
  IconLoader2, IconAlertTriangle, IconInfoCircle, IconLock,
  IconCalculator, IconCheck, IconChartBar, IconClockHour4,
} from '@tabler/icons-react';
import type { MafProjectData, MafIntercalaire, Project } from '../types';
import {
  computeAssiette, computeCotisation,
  MAF_TAUX_FIXES, MAF_INTERCALAIRE_LABELS, MAF_INTERCALAIRE_ORDER,
  TAUX_MISSION_OPTIONS,
  computePartInteret,
} from '../lib/mafUtils';

// ─── Constants ────────────────────────────────────────────────────────────────

const INTERCALAIRES: MafIntercalaire[] = MAF_INTERCALAIRE_ORDER;

const INTERCALAIRE_DESCRIPTIONS: Record<MafIntercalaire, string> = {
  jaune: 'Missions complètes ou partielles de maîtrise d\'œuvre (formule M × T × P). Chantiers ouverts ou en cours.',
  vert: 'Projet architectural limité au permis de construire. Maisons individuelles neuves ou immeubles d\'habitation neufs < 2 000 m². M = coût moyen × surface plancher.',
  ami: 'Maisons individuelles avec mission au-delà du simple permis de construire (nécessite une demande préalable).',
  grand_chantier: 'Chantiers > 30 M€ HT, ou entre 20 et 30 M€ sans CCRD. Nécessite un accord de garantie MAF préalable.',
  violet: 'Missions sans exécution de travaux : conseil, faisabilité, programmation, urbanisme, étude sans suite, expertise. Taux : 0,3593 ‰',
  orange_clair: 'AMO, relevés, états des lieux, copropriété. Taux : 1,3047 ‰',
  orange_fonce: 'Missions avec convention spéciale : loi Carrez, diagnostics, évaluation immobilière, ouvrages d\'art. Taux : 1,3047 ‰',
  bleu: 'Mission de BIM Manager sans intervention dans la maîtrise d\'œuvre (intercalaire HAR). Taux : 3,0065 ‰',
  rose: 'Ouvrages non soumis à l\'obligation d\'assurance (art. L 243-1-1 code des assurances).',
  tabac: 'Missions dossier autorisation de construire pour équipements à vocation strictement professionnelle (antennes, éoliennes…).',
  gris: 'Missions VIR (vente d\'immeuble à rénover) et VEFA (vente d\'immeuble à construire).',
  puc: 'Police Unique de Chantier — chantiers couverts par une PUC souscrite par le maître d\'ouvrage.',
};

const SISMICITE_OPTIONS = ['Très faible', 'Faible', 'Modérée', 'Moyenne', 'Forte'];
const RETRAIT_ARGILES_OPTIONS = ['Non exposée', 'Faible', 'Moyen', 'Fort'];
const TYPE_MOA_OPTIONS = ['Privé', 'Public', 'Copropriété'];
const TYPE_OUVRAGE_OPTIONS = ['Maison individuelle', 'Logements collectifs', 'Bureaux', 'ERP', 'Industrie / Entrepôt', 'Équipement public', 'Autre'];
const NATURE_TRAVAUX_OPTIONS = ['Neuf', 'Réhabilitation', 'Extension', 'Entretien / Aménagements légers', 'Démolition'];

const INTERCALAIRES_TRAVAUX: MafIntercalaire[] = ['jaune', 'ami', 'grand_chantier'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | undefined) {
  if (!n && n !== 0) return '—';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtNum(n: number | undefined) {
  if (!n && n !== 0) return '—';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Statut badge ─────────────────────────────────────────────────────────────

function StatutBadge({ statut }: { statut?: 'brouillon' | 'declaree' }) {
  if (statut === 'declaree') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: '#d3f9d8', color: '#2f9e44' }}>
        <IconCheck size={10} /> Déclarée
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: '#fff4e6', color: '#e67700' }}>
      <IconClockHour4 size={10} /> Brouillon
    </span>
  );
}

// ─── Entry form ───────────────────────────────────────────────────────────────

interface EntryFormProps {
  entry: Partial<MafProjectData>;
  intercalaire: MafIntercalaire;
  year: number;
  projects: Project[];
  tauxContratPermil: number;
  onSave: (data: Partial<MafProjectData>) => void;
  onClose: () => void;
  isSaving: boolean;
}

function EntryForm({ entry, intercalaire, year, projects, tauxContratPermil, onSave, onClose, isSaving }: EntryFormProps) {
  const [form, setForm] = useState<Partial<MafProjectData> & { projectId?: string }>({
    intercalaire,
    ...entry,
  });
  const [linkedProject, setLinkedProject] = useState<Project | null>(null);
  const [partFromFee, setPartFromFee] = useState<number | null>(null);
  const [isCalcLoading, setIsCalcLoading] = useState(false);
  const [situationSource, setSituationSource] = useState<{ numero: number; date: string } | null>(null);

  const isHonoraires = ['violet', 'orange_clair', 'orange_fonce', 'bleu', 'rose', 'tabac', 'gris', 'puc'].includes(intercalaire);
  const isVert = intercalaire === 'vert';
  const hasTravaux = INTERCALAIRES_TRAVAUX.includes(intercalaire);
  const isLocked = entry.statut === 'declaree';

  const handleProjectChange = useCallback(async (projectId: string) => {
    setForm((f: any) => ({ ...f, projectId }));
    setSituationSource(null);
    if (!projectId) { setLinkedProject(null); return; }
    const proj = projects.find(p => p.id === projectId) ?? null;
    setLinkedProject(proj);
    if (proj) {
      try {
        const proposals = await apiFetch<any[]>(`/api/proposals?project_id=${projectId}`);
        const latestProposal = proposals?.[0];
        if (latestProposal?.fee_distribution) {
          const p = computePartInteret(latestProposal.fee_distribution);
          setPartFromFee(p);
        }
      } catch { /* ignore */ }
    }
  }, [projects]);

  // Calcul automatique depuis les situations de travaux
  const handleCalcFromSituations = useCallback(async () => {
    const projectId = (form as any).projectId;
    if (!projectId) return;
    setIsCalcLoading(true);
    try {
      const result = await apiFetch<{
        montantCumulFinAnnee: number;
        montantCumulAnneePrecedente: number;
        situationCount: number;
        source: { situationNumero: number; situationDate: string } | null;
      }>(`/api/maf/v1/situations-cumul?project_id=${projectId}&year=${year}`);

      setForm(f => ({
        ...f,
        montantCumulFinAnnee: result.montantCumulFinAnnee,
        montantCumulAnneePrecedente: result.montantCumulAnneePrecedente,
        sourceSituationNumero: result.source?.situationNumero,
        sourceSituationDate: result.source?.situationDate,
      }));
      if (result.source) {
        setSituationSource({ numero: result.source.situationNumero, date: result.source.situationDate });
      }
    } catch (e) {
      console.error('Calcul situations error', e);
    } finally {
      setIsCalcLoading(false);
    }
  }, [(form as any).projectId, year]);

  const tauxPermil = MAF_TAUX_FIXES[intercalaire] ?? tauxContratPermil;
  const tauxMission = linkedProject?.taux_mission ?? (form as any).tauxMission ?? 100;
  const partInteret = partFromFee ?? linkedProject?.part_interet ?? (form as any).partInteret ?? 100;

  const { assiette } = computeAssiette({
    intercalaire,
    montantCumulFinAnnee: form.montantCumulFinAnnee,
    montantCumulAnneePrecedente: form.montantCumulAnneePrecedente,
    tauxMission,
    partInteret,
    surfacePlancher: linkedProject?.surface_plancher,
    categorieProjet: linkedProject?.categorie_projet,
    honorairesHt: form.honorairesHt,
  });
  const cotisation = computeCotisation(assiette, tauxPermil);
  const montantM = isVert
    ? assiette / (tauxMission / 100) / (partInteret / 100)
    : (form.montantCumulFinAnnee ?? 0) - (form.montantCumulAnneePrecedente ?? 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
          <div>
            <h3 className="font-bold text-base flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
              {entry.id ? 'Modifier' : 'Ajouter'} — {MAF_INTERCALAIRE_LABELS[intercalaire]}
              {isLocked && <IconLock size={14} style={{ color: 'var(--tblr-muted)' }} />}
            </h3>
            <p className="text-xs mt-0.5 flex items-center gap-2" style={{ color: 'var(--tblr-muted)' }}>
              Intercalaire {intercalaire} — {year}
              {isLocked && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: '#d3f9d8', color: '#2f9e44' }}>Déclarée — lecture seule</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>Fermer</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Projet lié */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Projet lié (pré-remplit les données)</label>
            <select
              disabled={isLocked}
              className="w-full p-2 rounded-lg text-sm"
              style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              value={(form as any).projectId ?? ''}
              onChange={e => handleProjectChange(e.target.value)}
            >
              <option value="">— Aucun projet lié —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name} {p.client ? `— ${p.client}` : ''}</option>)}
            </select>
            {linkedProject?.maf_intercalaire && linkedProject.maf_intercalaire !== intercalaire && (
              <p className="mt-1 text-[11px] flex items-center gap-1" style={{ color: '#e67700' }}>
                <IconAlertTriangle size={12} />
                Ce projet est déclaré en type de mission « {MAF_INTERCALAIRE_LABELS[linkedProject.maf_intercalaire]} » ({linkedProject.maf_intercalaire.replace('_', ' ')}) — vérifiez que l'intercalaire {intercalaire} est le bon.
              </p>
            )}
          </div>

          {!isHonoraires && (
            <>
              {/* Section 1 : Détails mission */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3 pb-1 border-b" style={{ color: 'var(--tblr-primary)', borderColor: 'var(--tblr-border)' }}>1 — Détails de la mission</h4>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Votre référence de mission"
                    value={(form as any).referenceMission ?? linkedProject?.project_code ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, referenceMission: v }))} />
                  <FormField label="Date d'ouverture du chantier (DOC)" type="date"
                    value={(form as any).docDate ?? linkedProject?.doc_date ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, docDate: v }))} />
                  <FormField label="Date prévisionnelle de fin" type="date"
                    value={(form as any).dateFinPrevue ?? linkedProject?.end_date ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, dateFinPrevue: v }))} />
                  <FormField label="Date de dépôt du permis de construire" type="date"
                    value={(form as any).dateDepotPc ?? linkedProject?.date_depot_pc ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, dateDepotPc: v }))} />
                  <FormField label="Chantier terminé en" type="date"
                    value={(form as any).dateFinReelle ?? linkedProject?.date_fin_reelle ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, dateFinReelle: v }))} />
                  {isVert && (
                    <FormField label="Surface Plancher (m²)" type="number"
                      value={String(linkedProject?.surface_plancher ?? '')}
                      disabled={isLocked}
                      onChange={v => setForm((f: any) => ({ ...f, surfacePlancher: parseFloat(v) }))} />
                  )}
                  <FormField label="N° du permis de construire"
                    value={(form as any).numPermisConstuire ?? linkedProject?.num_permis_construire ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, numPermisConstuire: v }))} />
                  <FormField label="Désignation / Nature du chantier"
                    value={(form as any).designationChantier ?? linkedProject?.type_et_cat ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, designationChantier: v }))} />
                  <FormField label="Montant prévisionnel marchés HT (€)" type="number"
                    value={String((form as any).montantPrevisionnelHt ?? linkedProject?.budget ?? '')}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, montantPrevisionnelHt: parseFloat(v) }))} />
                </div>
              </div>

              {/* Section risques + études + localisation + MOA */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3 pb-1 border-b" style={{ color: 'var(--tblr-primary)', borderColor: 'var(--tblr-border)' }}>Risques naturels — Études techniques — Localisation — MOA</h4>
                <div className="grid grid-cols-2 gap-3">
                  <FormSelect label="Sismicité" options={SISMICITE_OPTIONS}
                    value={(form as any).sismicite ?? linkedProject?.sismicite ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, sismicite: v }))} />
                  <FormSelect label="Retrait - gonflement des argiles" options={RETRAIT_ARGILES_OPTIONS}
                    value={(form as any).retraitArgiles ?? linkedProject?.retrait_argiles ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, retraitArgiles: v }))} />
                  <FormCheckbox label="Appel à un BET de structure"
                    checked={!!((form as any).betStructure ?? linkedProject?.bet_structure)}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, betStructure: v }))} />
                  <FormCheckbox label="Étude de sol"
                    checked={!!((form as any).etudeSol ?? linkedProject?.etude_sol)}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, etudeSol: v }))} />
                  <FormCheckbox label="Mission réalisée sous BIM"
                    checked={!!((form as any).missionBim ?? linkedProject?.mission_bim)}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, missionBim: v }))} />
                  <FormField label="Adresse du chantier"
                    value={(form as any).adresseChantier ?? linkedProject?.adresse_terrain ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, adresseChantier: v }))} />
                  <FormField label="Code postal / Ville"
                    value={(form as any).cpChantier ?? linkedProject?.cp_ville_terrain ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, cpChantier: v }))} />
                  <FormField label="Pays" value={(form as any).pays ?? 'France'}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, pays: v }))} />
                  <FormField label="Maître de l'ouvrage"
                    value={(form as any).maitreOuvrage ?? linkedProject?.client ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, maitreOuvrage: v }))} />
                  <FormSelect label="Type de maître d'ouvrage" options={TYPE_MOA_OPTIONS}
                    value={(form as any).typeMoa ?? linkedProject?.type_moa ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, typeMoa: v }))} />
                  <FormSelect label="Type d'ouvrage" options={TYPE_OUVRAGE_OPTIONS}
                    value={(form as any).typeOuvrage ?? linkedProject?.type_projet ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, typeOuvrage: v }))} />
                  <FormSelect label="Travaux" options={NATURE_TRAVAUX_OPTIONS}
                    value={(form as any).natureTravaux ?? linkedProject?.nature_travaux_maf ?? ''}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, natureTravaux: v }))} />
                </div>
              </div>

              {/* Section 2 : Financier */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3 pb-1 border-b" style={{ color: 'var(--tblr-primary)', borderColor: 'var(--tblr-border)' }}>2 — Éléments financiers de la mission</h4>

                {/* Bouton calcul depuis situations (intercalaires avec travaux seulement) */}
                {hasTravaux && !isVert && (form as any).projectId && !isLocked && (
                  <div className="mb-3">
                    <button
                      onClick={handleCalcFromSituations}
                      disabled={isCalcLoading}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors"
                      style={{ background: '#e7f5ff', borderColor: '#74c0fc', color: '#1971c2' }}
                    >
                      {isCalcLoading
                        ? <IconLoader2 size={14} className="animate-spin" />
                        : <IconCalculator size={14} />}
                      Calculer A depuis les situations de travaux
                    </button>
                    {situationSource && (
                      <p className="mt-1 text-[11px]" style={{ color: '#1971c2' }}>
                        ✓ Calculé à partir de la situation n°{situationSource.numero} du {new Date(situationSource.date).toLocaleDateString('fr-FR')}
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <FormField label="A — Montant cumulé travaux HT depuis DOC au 31/12" type="number"
                    value={String(form.montantCumulFinAnnee ?? '')}
                    disabled={isLocked}
                    onChange={v => setForm((f: any) => ({ ...f, montantCumulFinAnnee: parseFloat(v) || undefined }))} />
                  <div>
                    <FormField label="B — Montant cumulé déclaré au 31/12/année précédente" type="number"
                      value={String(form.montantCumulAnneePrecedente ?? '')}
                      disabled={isLocked}
                      onChange={v => setForm((f: any) => ({ ...f, montantCumulAnneePrecedente: parseFloat(v) || undefined }))} />
                    {form.montantCumulAnneePrecedente !== undefined && form.montantCumulAnneePrecedente > 0 && (
                      <p className="mt-0.5 text-[10px]" style={{ color: 'var(--tblr-muted)' }}>
                        Repris depuis la déclaration {year - 1}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-2 p-3 rounded-lg text-sm font-mono" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
                  M (travaux exécutés dans l'année) = A − B = <strong>{fmtNum(montantM)} €</strong>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>T — Taux de la mission</label>
                    <select
                      disabled={isLocked}
                      className="w-full p-2 rounded-lg text-sm"
                      style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      value={tauxMission}
                      onChange={e => setForm((f: any) => ({ ...f, tauxMission: parseFloat(e.target.value) }))}
                    >
                      {TAUX_MISSION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>
                      P — Part d'intérêt pondérée (%)
                      {partFromFee !== null && (
                        <span className="ml-2 font-normal normal-case text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#d3f9d8', color: '#2f9e44' }}>
                          Calculé depuis la répartition des honoraires
                        </span>
                      )}
                    </label>
                    <input
                      type="number" min="0" max="100" step="0.01"
                      disabled={isLocked}
                      className="w-full p-2 rounded-lg text-sm"
                      style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      value={partInteret}
                      onChange={e => setForm((f: any) => ({ ...f, partInteret: parseFloat(e.target.value) }))}
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {isHonoraires && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-3 pb-1 border-b" style={{ color: 'var(--tblr-primary)', borderColor: 'var(--tblr-border)' }}>Honoraires</h4>
              <FormField label="Montant global des honoraires HT (€)" type="number"
                value={String(form.honorairesHt ?? '')}
                disabled={isLocked}
                onChange={v => setForm((f: any) => ({ ...f, honorairesHt: parseFloat(v) || undefined }))} />
            </div>
          )}

          {/* Section 3 : Assiette */}
          <div className="p-4 rounded-xl border-2" style={{ borderColor: 'var(--tblr-primary)', background: 'var(--tblr-primary-lt)' }}>
            <h4 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-primary)' }}>3 — Assiette de votre cotisation</h4>
            {!isHonoraires ? (
              <div className="text-lg font-bold font-mono" style={{ color: 'var(--tblr-primary)' }}>
                M × T × P = {fmtNum(assiette)} € HT
              </div>
            ) : (
              <div className="text-lg font-bold font-mono" style={{ color: 'var(--tblr-primary)' }}>
                Assiette honoraires = {fmtNum(assiette)} € HT
              </div>
            )}
            <div className="text-sm mt-1" style={{ color: 'var(--tblr-muted)' }}>
              Taux : {tauxPermil} ‰ → Cotisation estimée : <strong>{fmtNum(cotisation)} €</strong>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>Notes</label>
            <textarea
              rows={2}
              disabled={isLocked}
              className="w-full p-2 rounded-lg text-sm"
              style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              value={form.notes ?? ''}
              onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 px-5 py-4 border-t" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>Annuler</button>
          {!isLocked && (
            <button
              onClick={() => onSave({ ...form, tauxCotisationPermil: tauxPermil })}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
              style={{ background: 'var(--tblr-primary)' }}
            >
              {isSaving ? <IconLoader2 size={14} className="animate-spin" /> : null}
              Enregistrer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Mini form components ─────────────────────────────────────────────────────

function FormField({ label, value, onChange, type = 'text', disabled }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>{label}</label>
      <input
        type={type}
        disabled={disabled}
        className="w-full p-2 rounded-lg text-sm disabled:opacity-60"
        style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

function FormSelect({ label, options, value, onChange, disabled }: {
  label: string; options: string[]; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>{label}</label>
      <select
        disabled={disabled}
        className="w-full p-2 rounded-lg text-sm disabled:opacity-60"
        style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function FormCheckbox({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} className="w-4 h-4 rounded" />
      <span className="text-sm" style={{ color: 'var(--tblr-text)' }}>{label}</span>
    </label>
  );
}

// ─── Suivi pluriannuel ────────────────────────────────────────────────────────

interface SuiviEntry extends MafProjectData {
  project?: Partial<Project>;
}

function SuiviView({ tauxContrat, onChangeStatut }: {
  tauxContrat: number;
  onChangeStatut: (id: string, statut: 'brouillon' | 'declaree') => Promise<void>;
}) {
  const [entries, setEntries] = useState<SuiviEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatut, setFilterStatut] = useState<'tous' | 'brouillon' | 'declaree'>('tous');

  const loadSuivi = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<SuiviEntry[]>('/api/maf/v1/suivi');
      setEntries(data ?? []);
    } catch (e) {
      console.error('Suivi load error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSuivi(); }, [loadSuivi]);

  const filtered = useMemo(() => {
    if (filterStatut === 'tous') return entries;
    return entries.filter(e => (e.statut ?? 'brouillon') === filterStatut);
  }, [entries, filterStatut]);

  // Grouper par projet
  const byProject = useMemo(() => {
    const map = new Map<string, SuiviEntry[]>();
    filtered.forEach(e => {
      const key = (e.project as any)?.name ?? e.projectId ?? 'Sans projet';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    });
    return map;
  }, [filtered]);

  // Toutes les années présentes
  const years = useMemo(() => {
    const ys = new Set(entries.map(e => e.declarationYear));
    return (Array.from(ys) as number[]).sort((a, b) => b - a);
  }, [entries]);

  const handleToggleStatut = async (entry: SuiviEntry) => {
    const newStatut = (entry.statut ?? 'brouillon') === 'brouillon' ? 'declaree' : 'brouillon';
    await onChangeStatut(entry.id, newStatut);
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, statut: newStatut } : e));
  };

  if (loading) return <div className="flex justify-center p-12"><IconLoader2 size={24} className="animate-spin" style={{ color: 'var(--tblr-primary)' }} /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>
          <IconChartBar size={16} className="inline mr-1" />
          Suivi pluriannuel des déclarations
        </h2>
        <div className="flex items-center gap-1 ml-auto">
          {(['tous', 'brouillon', 'declaree'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatut(s)}
              className="px-3 py-1 rounded-lg text-xs font-medium"
              style={filterStatut === s
                ? { background: 'var(--tblr-primary)', color: '#fff' }
                : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', border: '1px solid var(--tblr-border)' }}
            >
              {s === 'tous' ? 'Tous' : s === 'brouillon' ? 'Brouillons' : 'Déclarées'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-8 text-center text-sm rounded-xl" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
          Aucune entrée trouvée. Commencez par ajouter des missions dans les intercalaires.
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--tblr-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Projet</th>
                <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Intercalaire</th>
                <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Année</th>
                <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>M (€ HT)</th>
                <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Assiette</th>
                {tauxContrat > 0 && <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Cotisation est.</th>}
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Statut</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, idx) => {
                const proj = e.project as any;
                const isHono = !INTERCALAIRES_TRAVAUX.includes(e.intercalaire) && e.intercalaire !== 'vert';
                const tauxPermil = MAF_TAUX_FIXES[e.intercalaire] ?? tauxContrat;
                const { assiette } = computeAssiette({
                  intercalaire: e.intercalaire,
                  montantCumulFinAnnee: e.montantCumulFinAnnee,
                  montantCumulAnneePrecedente: e.montantCumulAnneePrecedente,
                  tauxMission: proj?.taux_mission,
                  partInteret: proj?.part_interet,
                  surfacePlancher: proj?.surface_plancher,
                  categorieProjet: proj?.categorie_projet,
                  honorairesHt: e.honorairesHt,
                });
                const cotis = computeCotisation(assiette, tauxPermil);
                const montantM = isHono ? (e.honorairesHt ?? 0) : (e.montantCumulFinAnnee ?? 0) - (e.montantCumulAnneePrecedente ?? 0);
                const statut = e.statut ?? 'brouillon';
                return (
                  <tr key={e.id} style={{ borderBottom: idx < filtered.length - 1 ? '1px solid var(--tblr-border)' : undefined }}>
                    <td className="px-4 py-3">
                      <div className="font-medium" style={{ color: 'var(--tblr-text)' }}>{proj?.name ?? '—'}</div>
                      <div className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{proj?.client ?? ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)' }}>
                        {e.intercalaire}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>{e.declarationYear}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs" style={{ color: 'var(--tblr-text)' }}>{fmtNum(montantM)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold" style={{ color: 'var(--tblr-text)' }}>{fmtNum(assiette)} €</td>
                    {tauxContrat > 0 && (
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold" style={{ color: 'var(--tblr-success)' }}>{fmt(cotis)}</td>
                    )}
                    <td className="px-4 py-3"><StatutBadge statut={statut} /></td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleStatut(e)}
                        className="text-xs px-2 py-1 rounded border transition-colors"
                        style={statut === 'brouillon'
                          ? { borderColor: '#2f9e44', color: '#2f9e44', background: 'transparent' }
                          : { borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)', background: 'transparent' }}
                        title={statut === 'brouillon' ? 'Marquer comme déclarée' : 'Repasser en brouillon'}
                      >
                        {statut === 'brouillon' ? '✓ Déclarer' : '↩ Brouillon'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Récap totaux par année */}
      {years.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--tblr-muted)' }}>Cotisations estimées par année</h3>
          <div className="flex flex-wrap gap-3">
            {years.map(y => {
              const yearEntries = entries.filter(e => e.declarationYear === y);
              const totalCotis = yearEntries.reduce((sum, e) => {
                const proj = e.project as any;
                const tauxPermil = MAF_TAUX_FIXES[e.intercalaire] ?? tauxContrat;
                const { assiette } = computeAssiette({
                  intercalaire: e.intercalaire,
                  montantCumulFinAnnee: e.montantCumulFinAnnee,
                  montantCumulAnneePrecedente: e.montantCumulAnneePrecedente,
                  tauxMission: proj?.taux_mission,
                  partInteret: proj?.part_interet,
                  surfacePlancher: proj?.surface_plancher,
                  categorieProjet: proj?.categorie_projet,
                  honorairesHt: e.honorairesHt,
                });
                return sum + computeCotisation(assiette, tauxPermil);
              }, 0);
              const allDeclared = yearEntries.every(e => e.statut === 'declaree');
              return (
                <div key={y} className="px-4 py-3 rounded-lg" style={{ background: 'var(--tblr-surface)', border: `1px solid ${allDeclared ? '#2f9e44' : 'var(--tblr-border)'}` }}>
                  <div className="text-xs font-bold uppercase" style={{ color: 'var(--tblr-muted)' }}>{y}</div>
                  <div className="text-base font-bold font-mono" style={{ color: 'var(--tblr-text)' }}>{tauxContrat > 0 ? fmt(totalCotis) : '—'}</div>
                  <div className="text-[10px] mt-0.5">{allDeclared ? <span style={{ color: '#2f9e44' }}>✓ Toutes déclarées</span> : <span style={{ color: '#e67700' }}>{yearEntries.filter(e => e.statut !== 'declaree').length} en attente</span>}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MafDeclaration() {
  const { tenantPlan } = useUser();
  const { settings } = useSettings();

  const [year, setYear] = useState(new Date().getFullYear());
  const [view, setView] = useState<'intercalaires' | 'suivi'>('intercalaires');
  const [activeTab, setActiveTab] = useState<MafIntercalaire>('jaune');
  const [entries, setEntries] = useState<(MafProjectData & { project?: Partial<Project> })[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [editEntry, setEditEntry] = useState<Partial<MafProjectData> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const mafEnabled = !!(settings as any)?.maf_enabled;
  const tauxContrat = parseFloat((settings as any)?.maf_taux_contrat_permil ?? 0);
  const numAdherent = (settings as any)?.maf_numero_adherent ?? '';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [entriesData, projectsData, summaryData] = await Promise.all([
        apiFetch<any[]>(`/api/maf/v1/entries?year=${year}`),
        apiFetch<Project[]>('/api/projects'),
        apiFetch<any>(`/api/maf/v1/summary?year=${year}`),
      ]);
      setEntries(entriesData ?? []);
      setProjects(projectsData ?? []);
      setSummary(summaryData);
    } catch (e) {
      console.error('MAF load error', e);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { loadData(); }, [loadData]);

  const tabEntries = useMemo(() => entries.filter(e => e.intercalaire === activeTab), [entries, activeTab]);

  const handleSave = async (data: Partial<MafProjectData>) => {
    setIsSaving(true);
    try {
      const payload = {
        ...data,
        intercalaire: activeTab,
        declaration_year: year,
        project_id: (data as any).projectId ?? null,
      };
      if (editEntry?.id) {
        await apiFetch(`/api/maf/v1/entries/${editEntry.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/maf/v1/entries', { method: 'POST', body: JSON.stringify(payload) });
      }
      setShowForm(false);
      setEditEntry(null);
      await loadData();
    } catch (e) {
      console.error('Save error', e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette entrée ?')) return;
    await apiFetch(`/api/maf/v1/entries/${id}`, { method: 'DELETE' });
    await loadData();
  };

  const handleChangeStatut = async (id: string, statut: 'brouillon' | 'declaree') => {
    await apiFetch(`/api/maf/v1/entries/${id}/statut`, { method: 'PATCH', body: JSON.stringify({ statut }) });
    await loadData();
  };

  const handleExportPdf = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`/api/maf/v1/export-pdf?year=${year}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('sb-token') ?? ''}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `declaration-maf-${year}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export error', e);
    } finally {
      setIsExporting(false);
    }
  };

  if (!mafEnabled) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center" style={{ color: 'var(--tblr-muted)' }}>
        <IconShieldCheck size={48} className="mb-4 opacity-30" />
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--tblr-text)' }}>Plugin MAF non activé</h2>
        <p className="text-sm max-w-sm">Activez le plugin <strong>Déclaration MAF</strong> dans <a href="/settings" className="underline" style={{ color: 'var(--tblr-primary)' }}>Paramètres → Marketplace</a> pour accéder à cette fonctionnalité.</p>
      </div>
    );
  }

  const tabSummary = summary?.intercalaires?.[activeTab];
  const grandTotal = summary?.cotisationTotaleEstimee ?? 0;

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
            <IconShieldCheck size={24} style={{ color: '#dc3545' }} />
            Déclaration MAF
          </h1>
          {numAdherent && <p className="text-sm mt-0.5" style={{ color: 'var(--tblr-muted)' }}>N° adhérent : {numAdherent}</p>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Vue toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
            <button
              onClick={() => setView('intercalaires')}
              className="px-3 py-1.5 rounded text-xs font-medium"
              style={view === 'intercalaires' ? { background: 'var(--tblr-surface)', color: 'var(--tblr-text)', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' } : { color: 'var(--tblr-muted)' }}
            >
              Par intercalaire
            </button>
            <button
              onClick={() => setView('suivi')}
              className="px-3 py-1.5 rounded text-xs font-medium"
              style={view === 'suivi' ? { background: 'var(--tblr-surface)', color: 'var(--tblr-text)', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' } : { color: 'var(--tblr-muted)' }}
            >
              Suivi pluriannuel
            </button>
          </div>

          {view === 'intercalaires' && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Année</label>
              <select
                className="p-2 rounded-lg text-sm"
                style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                value={year}
                onChange={e => setYear(parseInt(e.target.value))}
              >
                {[2022, 2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}

          <button
            onClick={handleExportPdf}
            disabled={isExporting}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          >
            {isExporting ? <IconLoader2 size={14} className="animate-spin" /> : <IconDownload size={14} />}
            Exporter PDF
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-3 rounded-lg border text-sm" style={{ background: '#fff4e6', borderColor: '#ffd8a8', color: '#c05500' }}>
        <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          La déclaration doit être validée et clôturée sur <strong>maf.fr</strong> avant le 31 mars {year + 1}.
          Cette page prépare vos données — elle ne remplace pas la saisie sur le site MAF.
          {!tauxContrat && <span className="ml-1 font-semibold">Renseignez votre taux contractuel MAF dans les Paramètres pour obtenir les estimations de cotisation.</span>}
        </div>
      </div>

      {/* Vue suivi */}
      {view === 'suivi' && (
        <SuiviView tauxContrat={tauxContrat} onChangeStatut={handleChangeStatut} />
      )}

      {/* Vue par intercalaire */}
      {view === 'intercalaires' && (
        <>
          {/* Intercalaire tabs */}
          <div className="flex flex-wrap gap-1 pb-1 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
            {INTERCALAIRES.map(inter => {
              const interSummary = summary?.intercalaires?.[inter];
              const count = interSummary?.entries?.length ?? 0;
              return (
                <button
                  key={inter}
                  onClick={() => setActiveTab(inter)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={activeTab === inter
                    ? { background: '#dc3545', color: '#fff' }
                    : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', border: '1px solid var(--tblr-border)' }
                  }
                >
                  {inter.replace('_', ' ')}
                  {count > 0 && (
                    <span className="ml-1 text-[10px] px-1 rounded" style={{ background: activeTab === inter ? 'rgba(255,255,255,0.3)' : 'var(--tblr-primary-lt)', color: activeTab === inter ? '#fff' : 'var(--tblr-primary)' }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab description */}
          <div className="flex items-start gap-2 text-sm" style={{ color: 'var(--tblr-muted)' }}>
            <IconInfoCircle size={15} className="mt-0.5 shrink-0" />
            <span>{INTERCALAIRE_DESCRIPTIONS[activeTab]}</span>
          </div>

          {/* Entries table */}
          {loading ? (
            <div className="flex justify-center p-8"><IconLoader2 size={24} className="animate-spin" style={{ color: 'var(--tblr-primary)' }} /></div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--tblr-border)' }}>
              {tabEntries.length === 0 ? (
                <div className="p-8 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>
                  Aucune entrée pour cet intercalaire. Cliquez sur &laquo; + Ajouter &raquo; pour commencer.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                      <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Projet / Mission</th>
                      <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>M (€ HT)</th>
                      <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>T</th>
                      <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>P</th>
                      <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Assiette</th>
                      <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Cotisation est.</th>
                      <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Statut</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {tabEntries.map((e, idx) => {
                      const proj = e.project as any;
                      const isHono = ['violet','orange_clair','orange_fonce','bleu','rose','tabac','gris','puc'].includes(e.intercalaire);
                      const tauxPermil = MAF_TAUX_FIXES[e.intercalaire] ?? tauxContrat;
                      const { assiette } = computeAssiette({
                        intercalaire: e.intercalaire,
                        montantCumulFinAnnee: e.montantCumulFinAnnee,
                        montantCumulAnneePrecedente: e.montantCumulAnneePrecedente,
                        tauxMission: proj?.taux_mission,
                        partInteret: proj?.part_interet,
                        surfacePlancher: proj?.surface_plancher,
                        categorieProjet: proj?.categorie_projet,
                        honorairesHt: e.honorairesHt,
                      });
                      const cotis = computeCotisation(assiette, tauxPermil);
                      const montantM = isHono ? e.honorairesHt ?? 0 : (e.montantCumulFinAnnee ?? 0) - (e.montantCumulAnneePrecedente ?? 0);
                      const statut = e.statut ?? 'brouillon';
                      return (
                        <tr key={e.id} style={{ borderBottom: idx < tabEntries.length - 1 ? '1px solid var(--tblr-border)' : undefined }}>
                          <td className="px-4 py-3">
                            <div className="font-medium" style={{ color: 'var(--tblr-text)' }}>{proj?.name ?? '—'}</div>
                            <div className="text-xs flex items-center gap-1.5 mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
                              {proj?.client ?? e.notes ?? ''}
                              {e.sourceSituationNumero && (
                                <span className="text-[10px] px-1.5 rounded" style={{ background: '#e7f5ff', color: '#1971c2' }}>
                                  Sit. n°{e.sourceSituationNumero}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs" style={{ color: 'var(--tblr-text)' }}>{fmtNum(montantM)}</td>
                          <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--tblr-text)' }}>{isHono ? '—' : `${proj?.taux_mission ?? 100}%`}</td>
                          <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--tblr-text)' }}>{isHono ? '—' : `${proj?.part_interet ?? 100}%`}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs font-semibold" style={{ color: 'var(--tblr-text)' }}>{fmtNum(assiette)} €</td>
                          <td className="px-4 py-3 text-right font-mono text-xs font-semibold" style={{ color: tauxContrat ? 'var(--tblr-success)' : 'var(--tblr-muted)' }}>
                            {tauxContrat ? `${fmtNum(cotis)} €` : '—'}
                          </td>
                          <td className="px-4 py-3"><StatutBadge statut={statut} /></td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 justify-end">
                              <button
                                onClick={() => handleChangeStatut(e.id!, statut === 'brouillon' ? 'declaree' : 'brouillon')}
                                className="p-1.5 rounded"
                                style={{ color: statut === 'brouillon' ? '#2f9e44' : 'var(--tblr-muted)' }}
                                title={statut === 'brouillon' ? 'Marquer comme déclarée' : 'Repasser en brouillon'}
                              >
                                <IconCheck size={13} />
                              </button>
                              <button
                                onClick={() => { setEditEntry(e); setShowForm(true); }}
                                className="p-1.5 rounded"
                                style={{ color: 'var(--tblr-primary)' }}
                              >
                                <IconEdit size={13} />
                              </button>
                              {statut === 'brouillon' && (
                                <button onClick={() => handleDelete(e.id!)} className="p-1.5 rounded" style={{ color: 'var(--tblr-danger)' }}>
                                  <IconTrash size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {tabSummary && (
                    <tfoot>
                      <tr style={{ background: 'var(--tblr-surface-2)', borderTop: '2px solid var(--tblr-border)' }}>
                        <td className="px-4 py-3 text-xs font-bold uppercase" style={{ color: 'var(--tblr-muted)' }}>Sous-total {activeTab}</td>
                        <td colSpan={4} />
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>{fmt(tabSummary.totalAssiette)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold" style={{ color: 'var(--tblr-success)' }}>{tauxContrat ? fmt(tabSummary.cotisationEstimee) : '—'}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>
          )}

          {/* Add button */}
          <button
            onClick={() => { setEditEntry({}); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white"
            style={{ background: '#dc3545' }}
          >
            <IconPlus size={14} />
            Ajouter une mission ({activeTab})
          </button>

          {/* Grand total */}
          {summary && (
            <div className="rounded-xl p-5 border-2" style={{ background: 'var(--tblr-surface)', borderColor: '#dc3545' }}>
              <h3 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: '#dc3545' }}>Récapitulatif de la déclaration {year}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(summary.intercalaires ?? {}).map(([inter, data]: [string, any]) => (
                  <div key={inter} className="p-3 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                    <div className="text-xs font-bold uppercase mb-1" style={{ color: 'var(--tblr-muted)' }}>Intercalaire {inter}</div>
                    <div className="text-sm font-mono font-semibold" style={{ color: 'var(--tblr-text)' }}>{fmt(data.totalAssiette)}</div>
                    {tauxContrat > 0 && <div className="text-xs" style={{ color: 'var(--tblr-success)' }}>Cotis. : {fmt(data.cotisationEstimee)}</div>}
                  </div>
                ))}
              </div>
              {tauxContrat > 0 && (
                <div className="mt-4 pt-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--tblr-border)' }}>
                  <span className="font-bold" style={{ color: 'var(--tblr-text)' }}>Cotisation totale estimée</span>
                  <span className="text-xl font-bold font-mono" style={{ color: '#dc3545' }}>{fmt(grandTotal)}</span>
                </div>
              )}
              {tenantPlan !== 'enterprise' && (
                <div className="mt-4 flex items-center gap-3 p-3 rounded-lg border text-sm" style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
                  <IconLock size={16} />
                  <div>
                    <span className="font-semibold" style={{ color: 'var(--tblr-text)' }}>Automatisation MAF disponible en plan Enterprise</span>
                    <span className="ml-1">— Soumettez votre déclaration directement sur maf.fr sans ressaisie.</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Form modal */}
      {showForm && editEntry !== null && (
        <EntryForm
          entry={editEntry}
          intercalaire={activeTab}
          year={year}
          projects={projects}
          tauxContratPermil={tauxContrat}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditEntry(null); }}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}
