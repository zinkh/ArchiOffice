import React from 'react';
import { IconCamera, IconTrash, IconX } from '@tabler/icons-react';
import { SignedImage } from '../SignedImage';
import { cn } from '../../lib/utils';
import type { Observation, ProjectLot, SiteReportNote, SiteReport } from '../../types';
import { DecoupageSelects } from './DecoupageFields';
import { openSignedUrl } from '../../lib/signedStorageUrl';
import { isReprenable } from '../../lib/observationsReserves';
import type { DecoupageChantier } from '../../lib/chantierDecoupage';
import { OBSERVATION_STATUTS, STATUT_COLORS, TYPE_COLORS, TYPE_LABELS } from './chantierConstants';
import { IconArrowRight } from '@tabler/icons-react';
import { CommitTextarea, ROW_FIELD, TOUCH_TARGET } from './fields';

// Chaque ligne tient sur UNE rangée à partir de 768 px, et s'empile en carte
// en dessous : l'ordre visuel change par `order-*`, l'ordre du DOM (donc celui
// du clavier) reste celui de la rangée de bureau.

const DELETE_BUTTON = cn('p-1 text-zinc-400 hover:text-red-500 flex items-center justify-center', TOUCH_TARGET);

export function RubriqueRow({ note, onSave, onDelete, onUploadPhoto, onRemovePhoto }: {
  note: SiteReportNote;
  onSave: (id: string, field: keyof SiteReportNote, value: string) => void;
  onDelete: (id: string) => void;
  onUploadPhoto: (id: string, file: File) => void;
  onRemovePhoto: (id: string, url: string) => void;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const photos = note.photos || [];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 p-2.5 md:p-2 rounded-lg bg-[var(--tblr-surface-2)]">
      <input
        type="date"
        aria-label="Date"
        className={cn(ROW_FIELD, 'order-1 shrink-0 w-[9.75rem] md:w-28 md:text-xs')}
        defaultValue={note.issue_date}
        onBlur={e => onSave(note.id, 'issue_date', e.target.value)}
      />
      <CommitTextarea
        aria-label="Texte"
        placeholder="Texte..."
        className={cn(ROW_FIELD, 'order-4 md:order-2 basis-full md:basis-0 md:flex-1 md:min-w-[120px] min-h-11 md:min-h-0')}
        value={note.text || ''}
        onCommit={v => onSave(note.id, 'text', v)}
      />
      <input
        aria-label="Société"
        placeholder="Société"
        className={cn(ROW_FIELD, 'order-5 md:order-3 basis-full md:basis-auto md:w-32 md:text-xs pointer-coarse:min-h-11 md:pointer-coarse:min-h-0')}
        defaultValue={note.responsible_company || ''}
        onBlur={e => onSave(note.id, 'responsible_company', e.target.value)}
      />
      <select
        aria-label="État de la rubrique"
        className={cn('order-2 md:order-4 ml-auto md:ml-0 shrink-0 text-xs px-2 py-1.5 rounded border border-[var(--tblr-border)] bg-transparent', TOUCH_TARGET)}
        value={note.status}
        onChange={e => onSave(note.id, 'status', e.target.value)}
      >
        <option value="open">Ouvert</option>
        <option value="done">Soldé</option>
      </select>
      <button type="button" aria-label="Ajouter une photo à la rubrique" title="Ajouter une photo" onClick={() => fileInputRef.current?.click()}
        className={cn('order-3 md:order-5 p-1 text-zinc-400 hover:text-[var(--tblr-primary)] flex items-center justify-center', TOUCH_TARGET)}>
        <IconCamera size={16} />
      </button>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onUploadPhoto(note.id, f); e.target.value = ''; }} />
      <button type="button" aria-label="Supprimer l'entrée" onClick={() => onDelete(note.id)} className={cn('order-3 md:order-6', DELETE_BUTTON)}>
        <IconTrash size={16} />
      </button>
      {photos.length > 0 && (
        <div className="order-6 md:order-7 basis-full flex flex-wrap gap-2">
          {photos.map((url, i) => (
            <div key={url} className="relative h-14 w-14 rounded-md overflow-hidden bg-zinc-100 dark:bg-zinc-800">
              <SignedImage src={url} alt={`Photo ${i + 1} de la rubrique`} className="h-full w-full object-cover" />
              <button type="button" aria-label={`Retirer la photo ${i + 1}`} onClick={() => onRemovePhoto(note.id, url)}
                className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white"><IconX size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DecisionRow({ decision, onChange, onRemove }: {
  decision: NonNullable<SiteReport['decisions']>[number];
  onChange: (patch: Partial<NonNullable<SiteReport['decisions']>[number]>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 p-2.5 md:p-2 rounded-lg bg-[var(--tblr-surface-2)]">
      <CommitTextarea
        aria-label="Décision"
        placeholder="Décision..."
        className={cn(ROW_FIELD, 'order-3 md:order-1 basis-full md:basis-0 md:flex-1 min-h-11 md:min-h-0')}
        value={decision.texte}
        onCommit={v => onChange({ texte: v })}
      />
      <select
        aria-label="Nature de la décision"
        className={cn('order-1 md:order-2 text-[0.6875rem] font-bold uppercase px-3 py-1.5 rounded-full border-none bg-zinc-200 dark:bg-zinc-700', TOUCH_TARGET)}
        value={decision.tag}
        onChange={e => onChange({ tag: e.target.value as any })}
      >
        <option value="planning">Planning</option>
        <option value="technique">Technique</option>
        <option value="financier">Financier</option>
      </select>
      <button type="button" aria-label="Supprimer la décision" onClick={onRemove} className={cn('order-2 md:order-3 ml-auto md:ml-0', DELETE_BUTTON)}>
        <IconTrash size={16} />
      </button>
    </div>
  );
}

export function ObservationRow({ obs, lots, decoupage, onSave, onUploadPhoto, onChangeLot, onDelete, onToReserve }: {
  obs: Observation;
  lots: ProjectLot[];
  decoupage: DecoupageChantier;
  onSave: (id: string, field: string, value: any) => void;
  onUploadPhoto: (id: string, file: File) => void;
  onChangeLot: (id: string, lotId: string) => void;
  onDelete: (id: string) => void;
  onToReserve: (id: string) => void;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const photos = obs.photos || [];
  const statut = obs.statut || 'À faire';
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 p-2.5 md:p-2 rounded-lg bg-[var(--tblr-surface-2)] group">
      {obs.number != null && (
        <span className="order-1 shrink-0 font-mono text-xs text-[var(--tblr-muted)]" title="Numéro de l'observation dans l'opération">#{String(obs.number).padStart(2, '0')}</span>
      )}
      <select
        aria-label="Nature"
        className={cn('order-1 shrink-0 text-[0.6875rem] font-bold uppercase px-2 py-1.5 rounded border-none cursor-pointer', TYPE_COLORS[obs.type || 'observation'], TOUCH_TARGET)}
        value={obs.type || 'observation'}
        onChange={e => onSave(obs.id, 'type', e.target.value)}
      >
        {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <CommitTextarea
        aria-label="Description"
        placeholder="Description..."
        className={cn(ROW_FIELD, 'order-5 md:order-2 basis-full md:basis-0 md:flex-1 md:min-w-[120px] min-h-11 md:min-h-0')}
        value={obs.texte || ''}
        onCommit={v => onSave(obs.id, 'texte', v)}
      />
      {obs.pendingSync && (
        <span className="order-3 shrink-0 text-[0.6875rem] font-bold uppercase px-1.5 py-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">en attente</span>
      )}
      <select
        aria-label="Statut"
        className={cn('order-2 md:order-3 shrink-0 text-[0.6875rem] font-bold uppercase tracking-wider px-2 py-1.5 rounded border-none cursor-pointer', STATUT_COLORS[statut], TOUCH_TARGET)}
        value={statut}
        onChange={e => onSave(obs.id, 'statut', e.target.value)}
      >
        {OBSERVATION_STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select
        aria-label="Urgence"
        className={cn('order-2 md:order-4 shrink-0 text-xs px-2 py-1.5 rounded border border-[var(--tblr-border)] bg-transparent', obs.urgence === 'bloquant' && 'bg-red-600 text-white border-red-600', TOUCH_TARGET)}
        value={obs.urgence || 'normal'}
        onChange={e => onSave(obs.id, 'urgence', e.target.value)}
      >
        <option value="normal">Normal</option>
        <option value="urgent">Urgent</option>
        <option value="bloquant">Bloquant</option>
      </select>
      <label className="order-6 md:order-5 shrink-0 flex items-center gap-2 text-xs text-[var(--tblr-muted)]">
        <span className="md:sr-only">Délai</span>
        <input
          type="date"
          className={cn(ROW_FIELD, 'w-[9.75rem] md:w-28 md:text-xs')}
          defaultValue={obs.due_date || ''}
          onBlur={e => onSave(obs.id, 'due_date', e.target.value)}
        />
      </label>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className={cn('order-4 md:order-6 ml-auto md:ml-0 shrink-0 p-1 text-zinc-400 hover:text-[var(--tblr-primary)] flex items-center justify-center', TOUCH_TARGET)}
        title="Ajouter une photo"
        aria-label="Ajouter une photo"
      >
        <IconCamera size={18} />
      </button>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onUploadPhoto(obs.id, f); e.target.value = ''; }} />
      <button type="button" aria-label="Supprimer l'observation" title="Supprimer" onClick={() => onDelete(obs.id)}
        className={cn('order-4 md:order-7 shrink-0 p-1 text-zinc-400 hover:text-red-500 flex items-center justify-center', TOUCH_TARGET)}>
        <IconTrash size={16} />
      </button>

      {/* Mêmes informations que les colonnes de l'onglet Observations : lot, bâtiment / phase, CR émis et levé, photos, réserve AOR. */}
      <div className="order-8 basis-full flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--tblr-muted)]">
        <select
          aria-label="Lot"
          className={cn('text-xs px-2 py-1.5 rounded border border-[var(--tblr-border)] bg-transparent max-w-full', TOUCH_TARGET)}
          value={obs.lot_id || ''}
          onChange={e => onChangeLot(obs.id, e.target.value)}
        >
          <option value="">Sans lot</option>
          {lots.map(l => <option key={l.id} value={l.id}>{l.lot_number} · {l.lot_title}</option>)}
        </select>
        <DecoupageSelects
          decoupage={decoupage}
          batimentId={obs.batiment_id}
          phaseId={obs.phase_id}
          className="flex flex-wrap gap-2"
          onChange={patch => {
            const [champ, valeur] = Object.entries(patch)[0] as [string, string | null];
            onSave(obs.id, champ, valeur || '');
          }}
        />
        {obs.created_report_number ? <span title="Compte-rendu où l'observation a été émise">CR émis <span className="font-mono">#{String(obs.created_report_number).padStart(2, '0')}</span></span> : null}
        {obs.resolved_report_number ? <span title="Compte-rendu où l'observation a été levée" className="text-green-600 dark:text-green-400">CR levée <span className="font-mono">#{String(obs.resolved_report_number).padStart(2, '0')}</span></span> : null}
        {photos.length > 0 && (
          <button type="button" onClick={() => openSignedUrl(photos[0])} className="text-[var(--tblr-primary)] hover:underline">
            {photos.length} photo{photos.length > 1 ? 's' : ''}
          </button>
        )}
        {obs.reserve_id ? (
          <span className="inline-flex items-center gap-1 font-semibold" title="Réserve de l'AOR qui reprend cette observation">
            <IconArrowRight size={13} /> Réserve AOR n° {obs.reserve_number ?? '—'}
          </span>
        ) : isReprenable(obs) && !obs.pendingSync ? (
          <button type="button" onClick={() => onToReserve(obs.id)} className="inline-flex items-center gap-1 text-[var(--tblr-primary)] hover:underline" title="Reprendre en réserve de l'AOR">
            <IconArrowRight size={13} /> En réserve
          </button>
        ) : null}
      </div>
    </div>
  );
}

