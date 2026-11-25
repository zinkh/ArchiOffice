// Import d'un planning de chantier depuis un fichier : XML Microsoft Project, XML GanttProject (.gan) ou PDF.
// Le fichier est lu, puis l'architecte voit ce qui serait repris avant de l'appliquer : rien n'est écrit tant
// que « Importer » n'est pas cliqué (et Ctrl+Z annule ensuite l'import d'un seul coup).
import { useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { IconAlertTriangle, IconFileImport, IconLoader2 } from '@tabler/icons-react';
import { ModalShell } from '../ui/ModalShell';
import {
  MAX_FICHIER_PLANNING, MESSAGE_MPP, bornesImport, datesVraisemblables, lireXmlPlanning, typeFichierPlanning,
  type ModeImportPlanning, type PlanningImporte,
} from '../../lib/planningChantierImport';
import type { LotPlanifiable } from '../../lib/planningChantier';

interface Props {
  projectId: string;
  lots: LotPlanifiable[];
  /** Le planning contient déjà des tâches : l'architecte choisit entre ajouter et remplacer. */
  aDesTaches: boolean;
  onApply: (importe: PlanningImporte, mode: ModeImportPlanning) => void;
  onClose: () => void;
}

const FORMATS: Record<PlanningImporte['format'], string> = {
  ganttproject: 'GanttProject', msproject: 'Microsoft Project XML', pdf: 'PDF lu par l’IA',
};
const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

export function PlanningImportDialog({ projectId, lots, aDesTaches, onApply, onClose }: Props) {
  const entree = useRef<HTMLInputElement>(null);
  const [nomFichier, setNomFichier] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [importe, setImporte] = useState<PlanningImporte | null>(null);
  const [mode, setMode] = useState<ModeImportPlanning>('ajouter');

  const lire = async (fichier: File) => {
    setErreur(null); setImporte(null); setNomFichier(fichier.name);
    const type = typeFichierPlanning(fichier.name);
    if (type === 'mpp') { setErreur(MESSAGE_MPP); return; }
    if (!type) { setErreur('Format non pris en charge. Formats acceptés : XML Microsoft Project, GanttProject (.gan) et PDF.'); return; }
    if (fichier.size > MAX_FICHIER_PLANNING) { setErreur('Le fichier dépasse 15 Mo.'); return; }
    setEnCours(true);
    try {
      if (type === 'xml') {
        setImporte(lireXmlPlanning(await fichier.text(), lots, () => crypto.randomUUID()));
      } else {
        const form = new FormData();
        form.append('file', fichier);
        // fetch et non apiFetch : celui-ci force un en-tête JSON. L'intercepteur ajoute le jeton et le cabinet.
        const reponse = await fetch(`/api/projects/${encodeURIComponent(projectId)}/planning-chantier/import-pdf`, { method: 'POST', body: form });
        const corps = await reponse.json().catch(() => null);
        if (!reponse.ok) throw new Error(corps?.error || 'La lecture du PDF a échoué.');
        setImporte(corps as PlanningImporte);
      }
    } catch (e: any) {
      setErreur(e?.message || 'La lecture du fichier a échoué.');
    } finally {
      setEnCours(false);
      if (entree.current) entree.current.value = '';
    }
  };

  const bornes = useMemo(() => (importe ? bornesImport(importe) : null), [importe]);
  const lotsConcernes = useMemo(() => new Set((importe?.taches ?? []).map(t => t.lotId).filter(Boolean)).size, [importe]);
  const liens = importe?.taches.reduce((n, t) => n + (t.dependencies?.length ?? 0), 0) ?? 0;
  const jalons = importe?.taches.filter(t => t.jalon).length ?? 0;
  const vraisemblable = !importe || datesVraisemblables(importe);

  return (
    <AnimatePresence>
      <ModalShell
        key="import-planning"
        title="Importer un planning"
        subtitle="Microsoft Project (XML), GanttProject ou PDF, à relire avant de l’appliquer"
        size="lg"
        busy={enCours}
        onClose={onClose}
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={enCours}>Annuler</button>
            <button type="button" className="btn btn-primary disabled:opacity-60" disabled={!importe || enCours} onClick={() => importe && onApply(importe, aDesTaches ? mode : 'ajouter')}>
              <IconFileImport size={18} aria-hidden="true" />Importer {importe ? pluriel(importe.taches.length, 'tâche') : ''}
            </button>
          </>
        )}
      >
        <div className="p-4 space-y-4 text-sm text-[var(--tblr-text)]">
          {erreur && (
            <div role="alert" className="px-3 py-2 rounded-lg text-xs flex items-start gap-2" style={{ border: '1px solid var(--tblr-danger)', color: 'var(--tblr-danger)' }}>
              <IconAlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" /><span>{erreur}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <input ref={entree} type="file" className="hidden" accept=".xml,.gan,.pdf,.mpp,application/xml,text/xml,application/pdf"
              aria-label="Fichier de planning à importer" onChange={e => { const f = e.target.files?.[0]; if (f) void lire(f); }} />
            <button type="button" className="btn btn-secondary" disabled={enCours} onClick={() => entree.current?.click()}>
              {enCours ? <IconLoader2 size={16} className="animate-spin" aria-hidden="true" /> : <IconFileImport size={16} aria-hidden="true" />}
              {enCours ? 'Lecture en cours…' : importe || erreur ? 'Choisir un autre fichier' : 'Choisir un fichier'}
            </button>
            {nomFichier && <span className="text-xs text-[var(--tblr-muted)] truncate max-w-full">{nomFichier}</span>}
          </div>

          {!importe && !erreur && !enCours && (
            <ul className="text-xs text-[var(--tblr-muted)] list-disc pl-5 space-y-1">
              <li><strong>XML Microsoft Project</strong> et <strong>GanttProject (.gan)</strong> : lecture exacte des dates, de l’avancement, des jalons, des liens et de leurs délais. Les groupes « Lot 02 · Charpente » sont rapprochés des lots de l’opération.</li>
              <li><strong>PDF</strong> : le texte du document est lu par l’IA (décompté des crédits IA du cabinet). Un PDF scanné, sans texte, n’est pas lisible. Relisez les dates avant d’importer.</li>
              <li>Le format <strong>.mpp</strong> n’est pas lu : enregistrez d’abord le plan au format XML depuis Microsoft Project.</li>
            </ul>
          )}

          {importe && (
            <div className="space-y-3" role="status">
              <p>
                <strong>{pluriel(importe.taches.length, 'tâche')}</strong> lue{importe.taches.length > 1 ? 's' : ''} ({FORMATS[importe.format]}
                {importe.nomProjet ? `, « ${importe.nomProjet} »` : ''}) sur {pluriel(lotsConcernes, 'lot')}
                {bornes ? `, du ${fmt(bornes.debut)} au ${fmt(bornes.fin)}` : ''}.
                {jalons > 0 && ` ${pluriel(jalons, 'jalon')}.`}{liens > 0 && ` ${pluriel(liens, 'lien')} entre tâches.`}
              </p>
              {!vraisemblable && (
                <p role="alert" className="text-xs" style={{ color: 'var(--tblr-danger)' }}>Certaines dates sont avant 2000 ou après 2100 : le document a probablement été mal lu. Vérifiez avant d’importer.</p>
              )}
              {importe.avertissements.length > 0 && (
                <ul className="list-disc pl-5 text-xs space-y-0.5 text-[var(--tblr-muted)]">
                  {importe.avertissements.map(a => <li key={a}>{a}</li>)}
                </ul>
              )}
              {aDesTaches && (
                <fieldset className="space-y-1">
                  <legend className="block text-xs font-semibold text-[var(--tblr-muted)] mb-1">Le planning contient déjà des tâches</legend>
                  <label className="flex items-start gap-2"><input type="radio" name="mode-import" className="mt-1" checked={mode === 'ajouter'} onChange={() => setMode('ajouter')} />
                    <span>Ajouter ces tâches au planning existant</span></label>
                  <label className="flex items-start gap-2"><input type="radio" name="mode-import" className="mt-1" checked={mode === 'remplacer'} onChange={() => setMode('remplacer')} />
                    <span>Remplacer tout le planning<span className="block text-xs text-[var(--tblr-muted)]">Les tâches actuelles, saisies à la main ou générées par l’IA, sont retirées. Le calendrier (jours fériés, congés) est conservé.</span></span></label>
                </fieldset>
              )}
              <ul className="max-h-48 overflow-y-auto border border-[var(--tblr-border)] rounded-lg divide-y divide-[var(--tblr-border)] text-xs" aria-label="Aperçu des tâches importées">
                {importe.taches.slice(0, 60).map(t => {
                  const lot = lots.find(l => l.id === t.lotId);
                  return (
                    <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="truncate flex-1">{t.jalon ? '◆ ' : ''}{t.libelle}</span>
                      <span className="text-[var(--tblr-muted)] shrink-0">{lot ? `Lot ${lot.lot_number}` : 'Général'}</span>
                      <span className="text-[var(--tblr-muted)] shrink-0 tabular-nums">{fmt(t.debut)}{t.fin !== t.debut ? ` → ${fmt(t.fin)}` : ''}</span>
                    </li>
                  );
                })}
              </ul>
              {importe.taches.length > 60 && <p className="text-xs text-[var(--tblr-muted)]">Et {importe.taches.length - 60} autres tâches.</p>}
              <p className="text-xs text-[var(--tblr-muted)]">Les tâches importées sont enregistrées comme saisies à la main : une génération IA ultérieure ne les efface pas. Ctrl+Z annule l’import.</p>
            </div>
          )}
        </div>
      </ModalShell>
    </AnimatePresence>
  );
}
