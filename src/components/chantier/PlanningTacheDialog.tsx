// Fenêtre de saisie d'une tâche du planning de chantier.
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { ModalShell } from '../ui/ModalShell';
import { placerApresPredecesseurs, cycleDependances, incoherencesDependances, dureeJours, dureeOuvree, MAX_DELAI, TOUS_LES_JOURS, type EstOuvre, type LotPlanifiable, type TachePlanning } from '../../lib/planningChantier';

interface Props {
  /** Tâche existante, ou brouillon d'une nouvelle (identifiant déjà tiré). */
  tache: TachePlanning;
  nouvelle: boolean;
  lots: LotPlanifiable[];
  taches: TachePlanning[];
  /** Jours travaillés du chantier ; tous les jours tant que le calcul en jours ouvrés n'est pas demandé. */
  ouvre?: EstOuvre;
  joursOuvres?: boolean;
  onSave: (tache: TachePlanning) => void;
  onDelete: () => void;
  onClose: () => void;
}

const champ = 'w-full rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-[var(--tblr-text)] px-3 py-2 text-sm pointer-coarse:min-h-11';
const etiquette = 'block text-xs font-semibold text-[var(--tblr-muted)] mb-1';

export function PlanningTacheDialog({ tache, nouvelle, lots, taches, ouvre = TOUS_LES_JOURS, joursOuvres = false, onSave, onDelete, onClose }: Props) {
  const { t: tr } = useTranslation();
  const [form, setForm] = useState<TachePlanning>(tache);
  const set = <K extends keyof TachePlanning>(cle: K, valeur: TachePlanning[K]) => setForm(prev => ({ ...prev, [cle]: valeur }));

  const libelle = form.libelle.trim();
  const datesValides = !!form.debut && !!form.fin && form.fin >= form.debut;
  const toutes = [...taches.filter(t => t.id !== form.id), form];
  const cycle = cycleDependances(toutes);
  const conflits = incoherencesDependances(toutes, ouvre).filter(c => c.tache.id === form.id || c.precedent.id === form.id);
  /** Un délai qui ne tient plus pousse la tâche après son prédécesseur (jamais l'inverse). */
  const changerDelai = (id: string, valeur: number) => setForm(prev => {
    const n = Math.min(MAX_DELAI, Math.max(0, Math.round(valeur) || 0));
    const delais = { ...(prev.delais ?? {}) };
    if (n) delais[id] = n; else delete delais[id];
    const suivante: TachePlanning = { ...prev, delais: Object.keys(delais).length ? delais : undefined };
    const enConflit = incoherencesDependances([...taches.filter(t => t.id !== prev.id), suivante], ouvre).some(c => c.tache.id === prev.id);
    return enConflit ? placerApresPredecesseurs(suivante, taches, ouvre) : suivante;
  });
  const erreur = cycle ? tr('planning_cycle') : !libelle ? 'Indiquez l’intitulé de la tâche.' : !form.debut ? 'Indiquez la date de début.' : !datesValides && !form.jalon ? 'La fin doit suivre le début.' : null;

  const enregistrer = () => {
    if (erreur) return;
    onSave({
      ...form,
      libelle,
      fin: form.jalon ? form.debut : form.fin,
      avancement: Math.min(100, Math.max(0, Math.round(Number(form.avancement) || 0))),
    });
  };

  return (
    <AnimatePresence>
      <ModalShell
        key="tache-planning"
        title={nouvelle ? 'Nouvelle tâche' : 'Modifier la tâche'}
        size="md"
        onClose={onClose}
        dirty={JSON.stringify(form) !== JSON.stringify(tache)}
        footer={(
          <>
            {!nouvelle && (
              <button type="button" className="btn btn-secondary mr-auto text-red-600" onClick={onDelete}>Supprimer</button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
            <button type="button" className="btn btn-primary disabled:opacity-60" disabled={!!erreur} onClick={enregistrer}>Enregistrer</button>
          </>
        )}
      >
        <form className="p-4 space-y-3" onSubmit={e => { e.preventDefault(); enregistrer(); }}>
          <div>
            <label className={etiquette} htmlFor="planning-libelle">Intitulé</label>
            <input id="planning-libelle" className={champ} value={form.libelle} maxLength={160} autoFocus
              onChange={e => set('libelle', e.target.value)} placeholder="Ex. : Fondations et dallage" />
          </div>
          <div>
            <label className={etiquette} htmlFor="planning-lot">Lot</label>
            <select id="planning-lot" className={champ} value={form.lotId} onChange={e => set('lotId', e.target.value)}>
              <option value="">Tâche générale du chantier</option>
              {lots.map(l => (
                <option key={l.id} value={l.id}>Lot {l.lot_number} · {l.lot_title}{l.contact_name ? ` (${l.contact_name})` : ''}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--tblr-text)]">
            <input type="checkbox" checked={!!form.jalon} onChange={e => set('jalon', e.target.checked)} />
            Jalon (échéance sans durée : hors d’eau, réception...)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={etiquette} htmlFor="planning-debut">{form.jalon ? 'Date' : 'Début'}</label>
              <input id="planning-debut" type="date" className={champ} value={form.debut}
                onChange={e => setForm(prev => ({ ...prev, debut: e.target.value, fin: prev.fin < e.target.value ? e.target.value : prev.fin }))} />
            </div>
            {!form.jalon && (
              <div>
                <label className={etiquette} htmlFor="planning-fin">Fin</label>
                <input id="planning-fin" type="date" className={champ} value={form.fin} min={form.debut} onChange={e => set('fin', e.target.value)} />
              </div>
            )}
          </div>
          {!form.jalon && datesValides && (
            <p className="text-xs text-[var(--tblr-muted)]">{joursOuvres
              ? tr('planning_duration_working', { n: dureeOuvree(form, ouvre), cal: dureeJours(form) })
              : `Durée : ${dureeJours(form)} jour${dureeJours(form) > 1 ? 's' : ''} calendaires.`}</p>
          )}
          <div>
            <label className={etiquette} htmlFor="planning-avancement">Avancement : {form.avancement} %</label>
            <input id="planning-avancement" type="range" min={0} max={100} step={5} className="w-full" value={form.avancement}
              onChange={e => set('avancement', Number(e.target.value))} />
          </div>
          <fieldset className="space-y-2">
            <legend className={etiquette}>{tr('planning_predecessors')}</legend>
            <p className="text-xs text-[var(--tblr-muted)]">{tr('planning_dependencies_help')}</p>
            <div className="max-h-48 overflow-y-auto rounded border border-[var(--tblr-border)]">
              {taches.filter(t => t.id !== form.id).map(t => {
                const coche = (form.dependencies ?? []).includes(t.id);
                const interdit = !coche && cycleDependances(toutes.map(x => x.id === form.id ? { ...x, dependencies: [...(form.dependencies ?? []), t.id] } : x));
                const lot = lots.find(l => l.id === t.lotId);
                return <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2 min-h-11 text-sm">
                  <label className="flex items-start gap-2 flex-1 min-w-[12rem]">
                    <input type="checkbox" checked={coche} disabled={interdit} onChange={e => {
                      const checked = e.target.checked;
                      setForm(prev => {
                        // Retirer un lien retire aussi son délai.
                        const delais = Object.fromEntries(Object.entries(prev.delais ?? {}).filter(([id]) => checked || id !== t.id));
                        const suivante = { ...prev, dependencies: checked ? [...(prev.dependencies ?? []), t.id] : (prev.dependencies ?? []).filter(id => id !== t.id), delais: Object.keys(delais).length ? delais : undefined };
                        return checked ? placerApresPredecesseurs(suivante, taches, ouvre) : suivante;
                      });
                    }} />
                    <span>{t.libelle} · {lot ? `Lot ${lot.lot_number}` : tr('planning_general_short')}{t.jalon ? ` · ${tr('planning_milestone')}` : ''}{interdit ? ` · ${tr('planning_cycle_forbidden')}` : ''}</span>
                  </label>
                  {coche && <label className="inline-flex items-center gap-1 text-xs text-[var(--tblr-muted)]">{tr('planning_delay')}
                    <input type="number" inputMode="numeric" min={0} max={MAX_DELAI} step={1} aria-label={tr('planning_delay_after', { name: t.libelle })}
                      className="w-16 rounded border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-[var(--tblr-text)] px-2 py-1 text-sm pointer-coarse:min-h-11"
                      value={form.delais?.[t.id] ?? 0} onChange={e => changerDelai(t.id, Number(e.target.value))} />
                    <span>{tr(joursOuvres ? 'planning_delay_unit_working' : 'planning_delay_unit')}</span>
                  </label>}
                </div>;
              })}
            </div>
          </fieldset>
          {conflits.length > 0 && <div role="status" className="text-xs text-[var(--tblr-text)]">
            {conflits.map(c => <p key={`${c.tache.id}:${c.precedent.id}`}>{tr('planning_dates_conflict', { task: c.tache.libelle, predecessor: c.precedent.libelle, date: c.precedent.fin })}</p>)}
          </div>}
          {erreur && <p role="alert" className="text-xs text-red-600">{erreur}</p>}
        </form>
      </ModalShell>
    </AnimatePresence>
  );
}
