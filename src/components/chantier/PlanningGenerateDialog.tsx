// Génération du planning de chantier par l'IA : l'architecte choisit la date de
// démarrage, les lots, les pièces à lire (planning d'une entreprise, notice,
// phasage du DCE) et des consignes ; le modèle PROPOSE, rien n'est écrit tant
// que la proposition n'est pas appliquée.
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { IconLoader2, IconSparkles, IconAlertTriangle } from '@tabler/icons-react';
import { ModalShell } from '../ui/ModalShell';
import { apiFetch } from '../../lib/api';
import {
  ajouterJours, aujourdhuiIso, bornesPlanning, estDateIso, lundiDe,
  type LotPlanifiable, type PlanningGenere,
} from '../../lib/planningChantier';

interface ProjectDocument { id: string; name: string; phase?: string | null }

interface Props {
  projectId: string;
  /** Début des travaux connu de la fiche (AAAA-MM-JJ), s'il y en a un. */
  debutProjet?: string;
  lots: LotPlanifiable[];
  /** Le planning contient déjà des tâches saisies à la main. */
  aDuManuel: boolean;
  onApply: (genere: PlanningGenere, lotIds: Set<string>, garderManuel: boolean) => void;
  onClose: () => void;
}

interface Proposition extends PlanningGenere { lot_ids: string[]; documents_read: number; ignored: string[] }

const LISIBLES = /\.(pdf|docx|pptx|xlsx|png|jpe?g|tiff?|webp|txt|csv)$/i;
const champ = 'w-full rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-[var(--tblr-text)] px-3 py-2 text-sm pointer-coarse:min-h-11';
const etiquette = 'block text-xs font-semibold text-[var(--tblr-muted)] mb-1';

const debutParDefaut = (debutProjet?: string) => {
  const base = debutProjet && estDateIso(debutProjet.slice(0, 10)) ? debutProjet.slice(0, 10) : aujourdhuiIso();
  return lundiDe(base);
};

export function PlanningGenerateDialog({ projectId, debutProjet, lots, aDuManuel, onApply, onClose }: Props) {
  const [dateDebut, setDateDebut] = useState(() => debutParDefaut(debutProjet));
  const [duree, setDuree] = useState('');
  const [lotIds, setLotIds] = useState<Set<string>>(() => new Set(lots.map(l => l.id)));
  const [documents, setDocuments] = useState<ProjectDocument[] | null>(null);
  const [pieces, setPieces] = useState<Set<string>>(new Set());
  const [consignes, setConsignes] = useState('');
  const [garderManuel, setGarderManuel] = useState(true);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [proposition, setProposition] = useState<Proposition | null>(null);

  useEffect(() => {
    apiFetch<ProjectDocument[]>(`/api/documents?project_id=${encodeURIComponent(projectId)}`)
      .then(docs => setDocuments((docs || []).filter(d => LISIBLES.test(d.name || ''))))
      .catch(() => setDocuments([]));
  }, [projectId]);

  const bascule = (set: Set<string>, id: string, maj: (s: Set<string>) => void, max = Infinity) => {
    const suivant = new Set(set);
    if (suivant.has(id)) suivant.delete(id); else if (suivant.size < max) suivant.add(id);
    maj(suivant);
  };

  const generer = async () => {
    setEnCours(true); setErreur(null); setProposition(null);
    try {
      const reponse = await apiFetch<Proposition>(`/api/projects/${encodeURIComponent(projectId)}/planning-chantier/generate`, {
        method: 'POST',
        body: JSON.stringify({
          date_debut: dateDebut,
          duree_cible_semaines: Number(duree) > 0 ? Number(duree) : undefined,
          lot_ids: [...lotIds],
          document_ids: [...pieces],
          instructions: consignes.trim() || undefined,
        }),
      });
      setProposition(reponse);
    } catch (e: any) {
      setErreur(e?.message || 'La génération a échoué.');
    } finally {
      setEnCours(false);
    }
  };

  const bornes = useMemo(() => proposition ? bornesPlanning({ version: 1, taches: proposition.taches, hypotheses: [], genereLe: null }) : null, [proposition]);
  const lotsConcernes = proposition ? new Set(proposition.taches.map(t => t.lotId).filter(Boolean)) : null;
  const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const peutGenerer = estDateIso(dateDebut) && lotIds.size > 0 && !enCours;

  const appliquer = () => {
    if (!proposition) return;
    // Les tâches générales (lot vide) sont toujours concernées par une génération.
    onApply(proposition, new Set(['', ...proposition.lot_ids]), garderManuel);
  };

  return (
    <AnimatePresence>
      <ModalShell
        key="generation-planning"
        title="Générer le planning avec l’IA"
        subtitle="Une proposition par lot, à relire avant de l’appliquer"
        size="lg"
        busy={enCours}
        onClose={onClose}
        footer={proposition ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setProposition(null)}>Modifier les paramètres</button>
            <button type="button" className="btn btn-primary" onClick={appliquer}>Appliquer au planning</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={enCours}>Annuler</button>
            <button type="button" className="btn btn-primary disabled:opacity-60" disabled={!peutGenerer} onClick={() => void generer()}>
              {enCours ? <IconLoader2 size={18} className="animate-spin" aria-hidden="true" /> : <IconSparkles size={18} aria-hidden="true" />}
              {enCours ? 'Génération en cours…' : 'Générer'}
            </button>
          </>
        )}
      >
        <div className="p-4 space-y-4">
          {erreur && (
            <div role="alert" className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
              <IconAlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" /><span>{erreur}</span>
            </div>
          )}

          {proposition ? (
            <div className="space-y-3 text-sm text-[var(--tblr-text)]" role="status">
              <p>
                <strong>{proposition.taches.length} tâche{proposition.taches.length > 1 ? 's' : ''}</strong> proposée{proposition.taches.length > 1 ? 's' : ''} sur{' '}
                {lotsConcernes?.size ?? 0} lot{(lotsConcernes?.size ?? 0) > 1 ? 's' : ''}
                {bornes ? `, du ${fmt(bornes.debut)} au ${fmt(bornes.fin)}` : ''}.
              </p>
              {proposition.ecartees > 0 && (
                <p className="text-xs text-amber-700">{proposition.ecartees} tâche{proposition.ecartees > 1 ? 's' : ''} écartée{proposition.ecartees > 1 ? 's' : ''} (lot inconnu ou durée illisible).</p>
              )}
              {proposition.ignored.length > 0 && (
                <p className="text-xs text-amber-700">Pièces non lues : {proposition.ignored.join(', ')}.</p>
              )}
              {proposition.hypotheses.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[var(--tblr-muted)] mb-1">Hypothèses retenues</p>
                  <ul className="list-disc pl-5 text-xs space-y-0.5">{proposition.hypotheses.map(h => <li key={h}>{h}</li>)}</ul>
                </div>
              )}
              {aDuManuel && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={garderManuel} onChange={e => setGarderManuel(e.target.checked)} />
                  Conserver les tâches que j’ai saisies à la main sur ces lots
                </label>
              )}
              <p className="text-xs text-[var(--tblr-muted)]">
                Les tâches générées par l’IA de ces lots sont remplacées ; les autres lots ne sont pas modifiés. Vous pourrez ajuster chaque tâche ensuite.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={etiquette} htmlFor="gen-debut">Démarrage des travaux</label>
                  <input id="gen-debut" type="date" className={champ} value={dateDebut} onChange={e => setDateDebut(e.target.value)} />
                  <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-1">La semaine 1 est celle du lundi {estDateIso(dateDebut) ? fmt(lundiDe(dateDebut)) : '…'}.</p>
                </div>
                <div>
                  <label className={etiquette} htmlFor="gen-duree">Durée visée en semaines (facultatif)</label>
                  <input id="gen-duree" type="number" min={1} max={260} className={champ} value={duree} onChange={e => setDuree(e.target.value)} placeholder="Ex. : 40" />
                  {Number(duree) > 0 && estDateIso(dateDebut) && (
                    <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-1">Réception visée vers le {fmt(ajouterJours(lundiDe(dateDebut), Number(duree) * 7 - 3))}.</p>
                  )}
                </div>
              </div>

              <fieldset>
                <legend className={etiquette}>Lots à planifier</legend>
                {lots.length === 0 ? (
                  <p className="text-xs text-[var(--tblr-muted)]">Aucun lot : renseignez d’abord les lots de l’opération.</p>
                ) : (
                  <ul className="max-h-48 overflow-y-auto border border-[var(--tblr-border)] rounded-lg divide-y divide-[var(--tblr-border)]">
                    {lots.map(l => (
                      <li key={l.id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer pointer-coarse:min-h-11">
                          <input type="checkbox" checked={lotIds.has(l.id)} onChange={() => bascule(lotIds, l.id, setLotIds)} />
                          <span className="font-semibold">Lot {l.lot_number}</span>
                          <span className="truncate flex-1">{l.lot_title}</span>
                          <span className="text-[var(--tblr-muted)] truncate max-w-[40%]">{l.contact_name || 'entreprise à désigner'}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>

              <fieldset>
                <legend className={etiquette}>Pièces à lire : planning d’une entreprise, notice, phasage du DCE (6 au plus, facultatif)</legend>
                {documents === null ? (
                  <IconLoader2 size={16} className="animate-spin text-[var(--tblr-muted)]" aria-label="Chargement" />
                ) : documents.length === 0 ? (
                  <p className="text-xs text-[var(--tblr-muted)]">Aucun document lisible dans cette affaire. Le planning sera établi à partir des lots, des montants et des durées de marché.</p>
                ) : (
                  <ul className="max-h-40 overflow-y-auto border border-[var(--tblr-border)] rounded-lg divide-y divide-[var(--tblr-border)]">
                    {documents.map(d => (
                      <li key={d.id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer pointer-coarse:min-h-11">
                          <input type="checkbox" checked={pieces.has(d.id)} disabled={!pieces.has(d.id) && pieces.size >= 6}
                            onChange={() => bascule(pieces, d.id, setPieces, 6)} />
                          <span className="truncate flex-1">{d.name}</span>
                          {d.phase && <span className="text-[0.6875rem] text-[var(--tblr-muted)] shrink-0">{d.phase}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>

              <div>
                <label className={etiquette} htmlFor="gen-consignes">Consignes (facultatif)</label>
                <textarea id="gen-consignes" rows={3} maxLength={2000} className={champ} value={consignes} onChange={e => setConsignes(e.target.value)}
                  placeholder="Ex. : bâtiment A avant le bâtiment B, pas de travaux bruyants en août, livraison de la charpente en semaine 12." />
              </div>
              <p className="text-[0.6875rem] text-[var(--tblr-muted)]">
                L’IA propose des durées d’après les montants de marché et les pièces fournies : c’est une base de travail, pas un engagement des entreprises.
                Décompté des crédits IA du cabinet.
              </p>
            </>
          )}
        </div>
      </ModalShell>
    </AnimatePresence>
  );
}
