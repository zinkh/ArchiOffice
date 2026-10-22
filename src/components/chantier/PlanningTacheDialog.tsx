// Fenêtre de saisie d'une tâche du planning de chantier.
import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { ModalShell } from '../ui/ModalShell';
import { dureeJours, type LotPlanifiable, type TachePlanning } from '../../lib/planningChantier';

interface Props {
  /** Tâche existante, ou brouillon d'une nouvelle (identifiant déjà tiré). */
  tache: TachePlanning;
  nouvelle: boolean;
  lots: LotPlanifiable[];
  onSave: (tache: TachePlanning) => void;
  onDelete: () => void;
  onClose: () => void;
}

const champ = 'w-full rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-[var(--tblr-text)] px-3 py-2 text-sm pointer-coarse:min-h-11';
const etiquette = 'block text-xs font-semibold text-[var(--tblr-muted)] mb-1';

export function PlanningTacheDialog({ tache, nouvelle, lots, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState<TachePlanning>(tache);
  const set = <K extends keyof TachePlanning>(cle: K, valeur: TachePlanning[K]) => setForm(prev => ({ ...prev, [cle]: valeur }));

  const libelle = form.libelle.trim();
  const datesValides = !!form.debut && !!form.fin && form.fin >= form.debut;
  const erreur = !libelle ? 'Indiquez l’intitulé de la tâche.' : !form.debut ? 'Indiquez la date de début.' : !datesValides && !form.jalon ? 'La fin doit suivre le début.' : null;

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
            <p className="text-xs text-[var(--tblr-muted)]">Durée : {dureeJours(form)} jour{dureeJours(form) > 1 ? 's' : ''} calendaires.</p>
          )}
          <div>
            <label className={etiquette} htmlFor="planning-avancement">Avancement : {form.avancement} %</label>
            <input id="planning-avancement" type="range" min={0} max={100} step={5} className="w-full" value={form.avancement}
              onChange={e => set('avancement', Number(e.target.value))} />
          </div>
          {erreur && <p role="alert" className="text-xs text-red-600">{erreur}</p>}
        </form>
      </ModalShell>
    </AnimatePresence>
  );
}
