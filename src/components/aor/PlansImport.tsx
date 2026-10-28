// Onglet AOR, bloc Plans : dépôt de plusieurs plans d'un coup (sélecteur ou glisser-déposer),
// avec un nom modifiable pour chacun avant l'envoi, et renommage d'un plan déjà importé.
// Les envois partent un par un vers POST /api/plans (un échec n'arrête pas les suivants).
import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconGripVertical, IconPencil, IconTrash, IconUpload, IconX } from '@tabler/icons-react';
import { ModalShell } from '../ui/ModalShell';
import {
  ajouterAuLot, nomPlanRetenu, nomsEnDouble, PLAN_NAME_MAX, PLANS_PAR_LOT_MAX, type PlanImportEntry,
} from '../../lib/planImport';

type Etat = 'attente' | 'envoi' | 'ok' | 'erreur';

interface PlanEnvoye { id: string; name: string; [k: string]: any }

const nouvelleCle = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()));

function contientFichiers(e: DragEvent) {
  return Array.from(e.dataTransfer?.types || []).includes('Files');
}

/** Zone de dépôt : enveloppe le bloc Plans et signale visuellement qu'on peut lâcher les fichiers. */
export function PlansDropZone({ onFiles, disabled, children }: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [actif, setActif] = useState(false);
  // dragenter/dragleave se déclenchent aussi sur les enfants : on compte pour ne pas clignoter.
  const profondeur = useRef(0);

  const entrer = (e: DragEvent) => {
    if (disabled || !contientFichiers(e)) return;
    e.preventDefault();
    profondeur.current++;
    setActif(true);
  };
  const sortir = (e: DragEvent) => {
    if (disabled || !contientFichiers(e)) return;
    profondeur.current = Math.max(0, profondeur.current - 1);
    if (profondeur.current === 0) setActif(false);
  };
  const survoler = (e: DragEvent) => {
    if (disabled || !contientFichiers(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const deposer = (e: DragEvent) => {
    if (disabled || !contientFichiers(e)) return;
    e.preventDefault();
    profondeur.current = 0;
    setActif(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onFiles(files);
  };

  return (
    <div className="relative" onDragEnter={entrer} onDragLeave={sortir} onDragOver={survoler} onDrop={deposer}>
      {children}
      {actif && (
        <div
          aria-hidden
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed pointer-events-none text-sm font-bold"
          style={{ borderColor: 'var(--tblr-primary)', background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
        >
          <IconUpload size={18} className="mr-2" />
          {t('plans_import_drop_here')}
        </div>
      )}
    </div>
  );
}

/** Fenêtre d'import : liste des fichiers, nom modifiable, envoi un par un avec état par ligne. */
export function PlansImportDialog({ projectId, category, initialFiles, existingNames, onUploaded, onNotify, onClose }: {
  projectId: string;
  category: string;
  initialFiles: File[];
  existingNames: string[];
  onUploaded: (plan: PlanEnvoye) => void;
  onNotify: (message: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<PlanImportEntry[]>([]);
  const [etats, setEtats] = useState<Record<string, Etat>>({});
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [envoi, setEnvoi] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const ajouter = useCallback((files: File[]) => {
    setEntries(prev => {
      const r = ajouterAuLot(prev, files, nouvelleCle);
      if (r.tronque) onNotify(t('plans_import_truncated', { max: PLANS_PAR_LOT_MAX }));
      else if (r.ignores) onNotify(t('plans_import_ignored', { count: r.ignores }));
      return r.entries;
    });
  }, [onNotify, t]);

  const demarre = useRef(false);
  useEffect(() => {
    if (demarre.current) return;
    demarre.current = true;
    ajouter(initialFiles);
  }, [ajouter, initialFiles]);

  const nomsRetenus = entries.map(e => nomPlanRetenu(e.name, e.file.name));
  const doubles = nomsEnDouble(nomsRetenus, existingNames);
  const restants = entries.filter(e => etats[e.key] !== 'ok');
  const dirty = !envoi && restants.length > 0;

  const renommer = (key: string, name: string) =>
    setEntries(prev => prev.map(e => (e.key === key ? { ...e, name } : e)));
  const retirer = (key: string) => setEntries(prev => prev.filter(e => e.key !== key));

  const envoyer = async () => {
    setEnvoi(true);
    let echecs = 0;
    let reussis = 0;
    for (const entry of entries) {
      if (etats[entry.key] === 'ok') continue;
      setEtats(prev => ({ ...prev, [entry.key]: 'envoi' }));
      try {
        const form = new FormData();
        form.append('file', entry.file);
        form.append('project_id', projectId);
        form.append('name', nomPlanRetenu(entry.name, entry.file.name));
        form.append('index', 'A');
        form.append('version', '1');
        form.append('category', category);
        const res = await fetch('/api/plans', { method: 'POST', body: form });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error || res.statusText);
        }
        onUploaded(await res.json());
        reussis++;
        setEtats(prev => ({ ...prev, [entry.key]: 'ok' }));
      } catch (err: any) {
        echecs++;
        setEtats(prev => ({ ...prev, [entry.key]: 'erreur' }));
        setErreurs(prev => ({ ...prev, [entry.key]: err?.message || t('projectdetail_plan_upload_failed') }));
      }
    }
    setEnvoi(false);
    if (!echecs) {
      onNotify(t('plans_import_done', { count: reussis }));
      onClose();
    }
  };

  return (
    <AnimatePresence>
      <ModalShell
        key="plans-import"
        title={t('plans_import_title')}
        subtitle={t('plans_import_subtitle')}
        onClose={onClose}
        busy={envoi}
        dirty={dirty && Object.keys(etats).length === 0}
        size="lg"
        footer={(
          <div className="flex items-center justify-between gap-3 w-full">
            <button type="button" className="btn" onClick={() => inputRef.current?.click()} disabled={envoi}>
              <IconUpload size={14} /> {t('plans_import_add_more')}
            </button>
            <div className="flex items-center gap-2">
              <button type="button" className="btn" onClick={onClose} disabled={envoi}>{t('btn_cancel')}</button>
              <button type="button" className="btn btn-primary" onClick={envoyer} disabled={envoi || restants.length === 0} aria-busy={envoi}>
                {envoi ? t('projectdetail_doe_uploading') : t('plans_import_start', { count: restants.length })}
              </button>
            </div>
          </div>
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => { ajouter(Array.from(e.target.files || [])); e.target.value = ''; }}
        />
        {entries.length === 0 ? (
          <p className="text-sm italic text-[var(--tblr-muted)]">{t('plans_import_empty')}</p>
        ) : (
          <ul className="divide-y divide-[var(--tblr-border)]">
            {entries.map((entry, i) => {
              const etat = etats[entry.key] || 'attente';
              const double = doubles.has(nomsRetenus[i].toLowerCase());
              const id = `plan-import-${entry.key}`;
              return (
                <li key={entry.key} className="py-3 flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor={id} className="sr-only">{t('plans_import_name_label', { file: entry.file.name })}</label>
                    <input
                      id={id}
                      type="text"
                      value={entry.name}
                      maxLength={PLAN_NAME_MAX}
                      disabled={envoi || etat === 'ok'}
                      onChange={e => renommer(entry.key, e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm"
                      style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
                    />
                    {etat === 'ok' ? (
                      <span className="flex items-center justify-center min-h-11 min-w-11 text-green-600" role="img" aria-label={t('plans_import_state_ok')}><IconCheck size={18} /></span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => retirer(entry.key)}
                        disabled={envoi}
                        aria-label={t('plans_import_remove', { name: entry.name })}
                        className="flex items-center justify-center min-h-11 min-w-11 text-[var(--tblr-muted)] disabled:opacity-50"
                      ><IconTrash size={16} /></button>
                    )}
                  </div>
                  <p className="text-xs text-[var(--tblr-muted)] break-words">
                    {entry.file.name} · {(entry.file.size / 1048576).toFixed(1)} Mo
                    {etat === 'envoi' && <> · {t('plans_import_state_sending')}</>}
                  </p>
                  {double && etat !== 'ok' && <p className="text-xs text-amber-600" role="status">{t('plans_import_duplicate')}</p>}
                  {etat === 'erreur' && <p className="text-xs text-red-600" role="alert">{erreurs[entry.key]}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </ModalShell>
    </AnimatePresence>
  );
}

/** Nom d'un plan avec un crayon pour le renommer sur place (Entrée enregistre, Échap annule). */
export function PlanName({ plan, onRenamed, onError, className }: {
  plan: { id: string; name: string };
  onRenamed: (id: string, name: string) => void;
  onError: (message: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [edition, setEdition] = useState(false);
  const [valeur, setValeur] = useState(plan.name);
  const [occupe, setOccupe] = useState(false);

  const enregistrer = async () => {
    const name = nomPlanRetenu(valeur, plan.name);
    if (name === plan.name) { setEdition(false); return; }
    setOccupe(true);
    try {
      const res = await fetch(`/api/plans/${plan.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || res.statusText);
      }
      onRenamed(plan.id, name);
      setEdition(false);
    } catch (err: any) {
      onError(t('plans_rename_failed', { error: err?.message || '' }));
    } finally {
      setOccupe(false);
    }
  };

  if (!edition) {
    return (
      <span className="inline-flex items-center gap-1 min-w-0">
        <span className={className ?? 'font-bold break-words'}>{plan.name}</span>
        <button
          type="button"
          onClick={() => { setValeur(plan.name); setEdition(true); }}
          aria-label={t('plans_rename_named', { name: plan.name })}
          title={t('plans_rename')}
          className="flex items-center justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:p-1 text-[var(--tblr-muted)] hover:text-[var(--tblr-primary)]"
        ><IconPencil size={14} /></button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 w-full">
      <input
        autoFocus
        type="text"
        value={valeur}
        maxLength={PLAN_NAME_MAX}
        disabled={occupe}
        aria-label={t('plans_rename_named', { name: plan.name })}
        onChange={e => setValeur(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); void enregistrer(); }
          if (e.key === 'Escape') { e.stopPropagation(); setEdition(false); }
        }}
        className="flex-1 min-w-0 px-2 py-1 rounded text-sm"
        style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
      />
      <button type="button" onClick={() => void enregistrer()} disabled={occupe} aria-label={t('plans_rename_save')}
        className="flex items-center justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:p-1 text-green-600 disabled:opacity-50"><IconCheck size={16} /></button>
      <button type="button" onClick={() => setEdition(false)} disabled={occupe} aria-label={t('btn_cancel')}
        className="flex items-center justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:p-1 text-[var(--tblr-muted)] disabled:opacity-50"><IconX size={16} /></button>
    </span>
  );
}

/** Poignée de réordonnancement d'un plan : se saisit à la souris, ou au doigt par un appui long. */
export function PlanGrip({ name, onPointerDown }: { name: string; onPointerDown: (e: PointerEvent<HTMLElement>) => void }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t('plans_reorder_handle', { name })}
      title={t('plans_reorder_hint')}
      onPointerDown={onPointerDown}
      className="flex items-center justify-center min-h-11 min-w-8 sm:min-h-0 sm:min-w-0 sm:p-1 shrink-0 cursor-grab active:cursor-grabbing touch-none text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] select-none"
    ><IconGripVertical size={16} /></span>
  );
}
