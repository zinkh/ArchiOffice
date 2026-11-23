// CCTP et DPGF d'une affaire partagée, côté confrère : lecture d'abord, annotation ensuite.
// Trois zones : le sommaire, le document, « Mes retours ». Un clic sur un passage le sélectionne et
// n'affiche les actions que sur lui ; ce que le confrère propose (texte, quantité, prix, unité, métré)
// ou commente s'accumule en brouillons et part en une fois. Le confrère n'écrit jamais dans le document :
// le cabinet valide chaque proposition. Le serveur ne construit que les lots accordés
// (server/projectShares/documentView.ts) : cet écran n'a rien à masquer.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';
import { texteBrut } from '../lib/cctpRichText';
import { batimentsDuMetre, serialiserMetre } from '../lib/quantites';
import { wordDiff } from '../lib/wordDiff';
import { MetreDialog } from './pro/MetreDialog';
import type { Ligne as LigneDocument } from '../types/dpgf';

type Mode = 'cctp' | 'dpgf';
type TargetType = 'lot' | 'chapitre' | 'ligne';

export interface SharedGrant { kind: string; access: 'read' | 'comment' | 'write' }

interface Ligne {
  id: string; numero: string | null; designation: string | null; unite: string | null; localisation: string | null;
  cctpDescription: string | null;
  /** Chiffres : toujours dans la vue DPGF, et dans la vue CCTP quand l'atelier DPGF est partagé. */
  quantite?: number | null; prixUnitaire?: number | null; prixTotal?: number | null;
  pourMemoire?: boolean | null;
  /** Le métré de l'article (lignes libellées dont la somme est la quantité), champs autorisés seulement. */
  quantiteDetails?: { id: string; libelle: string | null; expression: string | null; quantite: number; niveau: string | null; local: string | null; batimentId?: string | null }[];
  /** Article réparti par bâtiment : la quantité de chaque bâtiment concerné. */
  quantitesBatiments?: Record<string, number>;
  children?: Ligne[];
}
interface Chapitre { id: string; numero: string | null; titre: string | null; cctpDescription: string | null; lignes: Ligne[] }
interface LotView { id: string; numero: string | null; titre: string | null; projectLotId: string; chapitres: Chapitre[] }
interface BatimentView { id: string; code: string; libelle: string | null; ordre: number }
interface DocView { titre: string | null; version: string | null; lots: LotView[]; multiBatiments?: boolean; batiments?: BatimentView[] }
interface SharedComment {
  id: string; resourceKind: Mode; lotId: string; targetType: TargetType; targetId: string;
  body: string; authorKind: 'guest' | 'cabinet'; authorName: string | null; createdAt: string | null; resolvedAt: string | null;
}
interface Proposal {
  id: string; lotId: string; targetType: TargetType; targetId: string; field: string; baseValue: string; proposedValue: string;
  status: 'pending' | 'applied' | 'rejected' | 'withdrawn' | 'outdated'; decisionNote: string | null; createdAt: string | null;
  pending: number; limit: number;
}

interface Target { lotId: string; targetType: TargetType; targetId: string }
/** Un retour pas encore envoyé : une proposition sur un champ, ou un commentaire sur un élément. */
interface Draft {
  key: string; kind: 'modif' | 'comment'; mode: Mode; target: Target; nodeKey: string;
  field?: string; value: string; base: string; error?: string;
}
type BlockStatus = 'draft' | 'pending' | 'rejected' | 'outdated' | 'applied';
interface EditField { field: string; current: string; multiline?: boolean }
type FigureField = 'quantite' | 'prixUnitaire' | 'unite';

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const STATUS_VAR: Record<BlockStatus, string> = {
  draft: '--tblr-primary', pending: '--tblr-warning', rejected: '--tblr-danger', outdated: '--tblr-muted', applied: '--tblr-success',
};
const STATUS_ORDER: BlockStatus[] = ['draft', 'pending', 'outdated', 'rejected', 'applied'];
const labelClass = 'block text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-[var(--tblr-muted)]';

const nodeKeyOf = (type: TargetType, id: string) => `${type}:${id}`;
const byDate = (a: { createdAt: string | null }, b: { createdAt: string | null }) => String(a.createdAt).localeCompare(String(b.createdAt));
const short = (value: string) => (value.length > 80 ? `${value.slice(0, 80)}…` : value || '·');
const metreLines = (value: string): number => { try { const v = JSON.parse(value); return Array.isArray(v) ? v.length : 0; } catch { return 0; } };
const estFeuille = (ligne: Ligne) => !ligne.children?.length;

/** « 12,5 m² × 48,50 € = 606,25 € » : ce que le confrère voit d'un article chiffré. */
function resumeChiffres(ligne: Ligne): string {
  return ligne.quantite != null && ligne.prixUnitaire != null
    ? `${num.format(ligne.quantite)} ${ligne.unite ?? ''} × ${eur.format(ligne.prixUnitaire)} = ${eur.format(ligne.prixTotal ?? 0)}`
    : '';
}

interface Ctx {
  mode: Mode; annotate: boolean; selected: string | null; select: (key: string | null) => void;
  comments: SharedComment[]; proposals: Proposal[]; drafts: Draft[];
  batiments?: BatimentView[];
  canComment: boolean;
  canProposeKind: (kind: Mode) => boolean;
  /** Ajoute (ou remplace) un brouillon ; faux quand la limite de retours est atteinte. */
  addDraft: (draft: Draft) => boolean;
  removeDraft: (key: string) => void;
}

function proposalsOf(ctx: Ctx, target: Target, field?: string): Proposal[] {
  return ctx.proposals
    .filter(p => p.lotId === target.lotId && p.targetType === target.targetType && p.targetId === target.targetId
      && p.status !== 'withdrawn' && (field === undefined || p.field === field))
    .sort(byDate);
}

function statusOfNode(ctx: Ctx, target: Target): BlockStatus | null {
  const nodeKey = nodeKeyOf(target.targetType, target.targetId);
  if (ctx.drafts.some(d => d.nodeKey === nodeKey)) return 'draft';
  const latest = new Map<string, Proposal>();
  for (const p of proposalsOf(ctx, target)) latest.set(p.field, p);
  const found = new Set([...latest.values()].map(p => p.status as BlockStatus));
  return STATUS_ORDER.find(s => found.has(s)) ?? null;
}

function StatusBadge({ status }: { status: BlockStatus }) {
  const { t } = useTranslation();
  const color = `var(${STATUS_VAR[status]})`;
  return (
    <span
      className="inline-block px-2 py-[3px] rounded text-[0.6875rem] font-semibold uppercase tracking-[0.04em]"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      {t(`shared_status_${status}`)}
    </span>
  );
}

function DiffView({ before, after }: { before: string; after: string }) {
  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap rounded px-3 py-2 border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)] text-[var(--tblr-text)]">
      {wordDiff(before, after).map((s, i) => s.type === 'add'
        ? <ins key={i} className="text-[var(--tblr-success)] underline">{s.text}</ins>
        : s.type === 'del'
          ? <del key={i} className="text-[var(--tblr-danger)]">{s.text}</del>
          : <span key={i}>{s.text}</span>)}
    </p>
  );
}

/** Le fil de commentaires d'un élément : ce que le confrère et le cabinet s'y sont dit. */
function Thread({ comments }: { comments: SharedComment[] }) {
  const { t } = useTranslation();
  if (!comments.length) return null;
  return (
    <div className="mt-2 space-y-1">
      {comments.map(c => (
        <div key={c.id} className="text-sm rounded px-3 py-2 border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)]">
          <div className="text-xs text-[var(--tblr-muted)]">
            {c.authorKind === 'cabinet' ? t('shared_comment_cabinet') : t('shared_comment_you')}
            {c.createdAt ? ` · ${new Date(c.createdAt).toLocaleDateString('fr-FR')}` : ''}
            {c.resolvedAt ? ` · ${t('shared_comment_resolved')}` : ''}
          </div>
          <div className="text-[var(--tblr-text)] whitespace-pre-wrap">{c.body}</div>
        </div>
      ))}
    </div>
  );
}

function CommentEditor({ ctx, target, label, onDone }: { ctx: Ctx; target: Target; label: string; onDone: () => void }) {
  const { t } = useTranslation();
  const nodeKey = nodeKeyOf(target.targetType, target.targetId);
  const existing = ctx.drafts.find(d => d.key === `${nodeKey}:comment`);
  const [text, setText] = useState(existing?.value ?? '');
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    if (ctx.addDraft({ key: `${nodeKey}:comment`, kind: 'comment', mode: ctx.mode, target, nodeKey, value: text.trim(), base: '' })) onDone();
  };
  return (
    <form onSubmit={save} className="mt-2 space-y-2">
      <label className={labelClass} htmlFor={`c-${nodeKey}`}>{label}</label>
      <textarea
        id={`c-${nodeKey}`} rows={2} maxLength={2000} value={text} autoFocus onChange={e => setText(e.target.value)}
        placeholder={t('shared_comment_placeholder')} className="tblr-input w-full"
      />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!text.trim()} className="btn btn-primary">{t('shared_edit_add')}</button>
        <button type="button" onClick={onDone} className="btn btn-ghost">{t('shared_proposal_cancel')}</button>
      </div>
    </form>
  );
}

/** Proposer une nouvelle version des champs texte d'un élément : un brouillon par champ réellement changé. */
function ModifEditor({ ctx, target, fields, onDone }: { ctx: Ctx; target: Target; fields: EditField[]; onDone: () => void }) {
  const { t } = useTranslation();
  const nodeKey = nodeKeyOf(target.targetType, target.targetId);
  const start = (f: EditField) => {
    const draft = ctx.drafts.find(d => d.key === `${nodeKey}:${f.field}`);
    if (draft) return draft.value;
    const last = proposalsOf(ctx, target, f.field).at(-1);
    return last?.status === 'pending' ? last.proposedValue : f.current;
  };
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.field, start(f)])));
  const [message, setMessage] = useState<string | null>(null);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const changed = fields.filter(f => values[f.field] !== f.current);
    if (!changed.length) { setMessage(t('shared_edit_nochange')); return; }
    for (const f of changed) {
      if (!ctx.addDraft({ key: `${nodeKey}:${f.field}`, kind: 'modif', mode: ctx.mode, target, nodeKey, field: f.field, value: values[f.field], base: f.current })) return;
    }
    // Un champ revenu à sa valeur d'origine n'est plus un retour.
    for (const f of fields.filter(x => values[x.field] === x.current)) ctx.removeDraft(`${nodeKey}:${f.field}`);
    onDone();
  };

  return (
    <form onSubmit={save} className="mt-2 space-y-3">
      {fields.map(f => {
        const id = `e-${nodeKey}-${f.field}`;
        const label = t(`shared_field_${f.field}`);
        return (
          <div key={f.field} className="space-y-1">
            <label className={labelClass} htmlFor={id}>{label}</label>
            {f.multiline
              ? <textarea id={id} rows={5} maxLength={20000} value={values[f.field]} onChange={e => setValues(v => ({ ...v, [f.field]: e.target.value }))} className="tblr-input w-full" />
              : <input id={id} maxLength={300} value={values[f.field]} onChange={e => setValues(v => ({ ...v, [f.field]: e.target.value }))} className="tblr-input w-full" />}
            {values[f.field] !== f.current && (
              <>
                <span className={labelClass}>{t('shared_edit_preview')}</span>
                <DiffView before={f.current} after={values[f.field]} />
              </>
            )}
          </div>
        );
      })}
      {message && <p role="alert" className="text-sm text-[var(--tblr-muted)]">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary">{t('shared_edit_add')}</button>
        <button type="button" onClick={onDone} className="btn btn-ghost">{t('shared_proposal_cancel')}</button>
      </div>
    </form>
  );
}

function figureAllowed(ligne: Ligne, field: FigureField): boolean {
  if (ligne.quantite === undefined || !estFeuille(ligne)) return false;
  // Avec un métré, la quantité se modifie par le métré (le serveur refuse de la proposer seule).
  return field !== 'quantite' || !(ligne.quantiteDetails ?? []).length;
}

/** Une quantité, un prix ou une unité : un clic la rend modifiable, la valeur saisie devient un brouillon. */
function FigureCell({ ctx, lot, ligne, field }: { ctx: Ctx; lot: LotView; ligne: Ligne; field: FigureField }) {
  const { t } = useTranslation();
  const target: Target = { lotId: lot.projectLotId, targetType: 'ligne', targetId: ligne.id };
  const key = `${nodeKeyOf('ligne', ligne.id)}:${field}`;
  const raw = ligne[field];
  const current = raw == null ? '' : String(raw);
  const draft = ctx.drafts.find(d => d.key === key);
  const last = proposalsOf(ctx, target, field).at(-1);
  const proposed = draft?.value ?? (last?.status === 'pending' ? last.proposedValue : null);
  const shown = ctx.annotate && proposed != null ? proposed : current;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  const label = t(`shared_field_${field}`);
  const format = (v: string) => v === '' ? '·' : field === 'quantite' ? num.format(Number(v)) : field === 'prixUnitaire' ? eur.format(Number(v)) : v;
  const editable = ctx.annotate && figureAllowed(ligne, field) && ctx.canProposeKind('dpgf');
  if (!editable) return <span>{format(shown)}</span>;

  const commit = () => {
    const numeric = field !== 'unite';
    const value = text.trim().replace(/\s/g, '').replace(',', '.');
    const next = numeric ? value : text.trim();
    if (numeric && (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0)) { setInvalid(true); return; }
    setInvalid(false);
    if (next === current) ctx.removeDraft(key);
    else if (!ctx.addDraft({ key, kind: 'modif', mode: ctx.mode, target, nodeKey: nodeKeyOf('ligne', ligne.id), field, value: next, base: current })) return;
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <input
          autoFocus value={text} aria-label={label} onChange={e => setText(e.target.value)} inputMode={field === 'unite' ? undefined : 'decimal'}
          maxLength={300} className="tblr-input w-24 text-right"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setEditing(false); setInvalid(false); } }}
          onBlur={commit}
        />
        {invalid && <span role="alert" className="text-xs text-[var(--tblr-danger)]">{t('shared_figure_invalid')}</span>}
      </span>
    );
  }
  const changed = proposed != null && proposed !== current;
  return (
    <button
      type="button" aria-label={t('shared_propose', { field: label })} onClick={() => { setText(shown); setEditing(true); }}
      className="min-w-[4.5rem] px-2 py-0.5 rounded text-right border"
      style={{
        borderColor: changed ? `var(${STATUS_VAR[draft ? 'draft' : 'pending']})` : 'var(--tblr-border)',
        background: changed ? 'var(--tblr-primary-lt)' : 'transparent',
      }}
    >
      {changed && <s className="block text-xs text-[var(--tblr-muted)]">{format(current)}</s>}
      {format(shown)}
    </button>
  );
}

/** Proposer un métré : la fenêtre de l'éditeur, puis un brouillon qui remplace toute la liste de lignes. */
function MetreButton({ ctx, lot, ligne }: { ctx: Ctx; lot: LotView; ligne: Ligne }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!(ctx.annotate && ctx.canProposeKind('dpgf') && ligne.quantite !== undefined && estFeuille(ligne))) return null;
  // La ligne telle que la fenêtre de l'éditeur l'attend : le métré actuel du confrère, avec la quantité et le prix vus.
  const pour: LigneDocument = {
    id: ligne.id, numero: ligne.numero ?? '', designation: ligne.designation ?? '', unite: ligne.unite ?? '',
    quantite: ligne.quantite ?? 0, prixUnitaire: ligne.prixUnitaire ?? 0, prixTotal: ligne.prixTotal ?? 0,
    pourMemoire: !!ligne.pourMemoire, type: 'ouvrage',
    quantiteDetails: (ligne.quantiteDetails ?? []).map(d => ({
      id: d.id, libelle: d.libelle ?? undefined, expression: d.expression ?? undefined, niveau: d.niveau ?? undefined, local: d.local ?? undefined, quantite: d.quantite,
      ...(d.batimentId ? { batimentId: d.batimentId } : {}),
    })),
    ...(ligne.quantitesBatiments ? { quantitesBatiments: ligne.quantitesBatiments } : {}),
  };
  // Un article réparti par bâtiment : le métré se compose par bâtiment, comme dans l'éditeur du cabinet.
  const batiments = batimentsDuMetre({ multiBatiments: !!ctx.batiments?.length, batiments: ctx.batiments as any }, pour as any);
  const key = `${nodeKeyOf('ligne', ligne.id)}:metre`;
  const save = (patch: Partial<LigneDocument>) => {
    const value = serialiserMetre(patch.quantiteDetails ?? [], { parBatiment: !!batiments?.length });
    const target: Target = { lotId: lot.projectLotId, targetType: 'ligne', targetId: ligne.id };
    if (ctx.addDraft({ key, kind: 'modif', mode: ctx.mode, target, nodeKey: nodeKeyOf('ligne', ligne.id), field: 'metre', value, base: '' })) setOpen(false);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary">{t('shared_propose_metre')}</button>
      {open && <MetreDialog ligne={pour} batiments={batiments} onClose={() => setOpen(false)} onSave={save} applyLabel={t('shared_edit_add')} erreur={null} />}
    </>
  );
}

/**
 * Tout ce qui s'ajoute sous un élément : son fil de commentaires, l'état de ses propositions et, quand il est
 * sélectionné, les actions (commenter, proposer une modification, chiffres, métré).
 */
function NodeExtras({ ctx, lot, targetType, targetId, label, textFields = [], ligne }: {
  ctx: Ctx; lot: LotView; targetType: TargetType; targetId: string; label: string; textFields?: EditField[]; ligne?: Ligne;
}) {
  const { t } = useTranslation();
  const target: Target = { lotId: lot.projectLotId, targetType, targetId };
  const nodeKey = nodeKeyOf(targetType, targetId);
  const selected = ctx.annotate && ctx.selected === nodeKey;
  const [open, setOpen] = useState<'comment' | 'modif' | null>(null);
  useEffect(() => { if (!selected) setOpen(null); }, [selected]);
  const thread = ctx.comments.filter(c => c.lotId === target.lotId && c.targetType === targetType && c.targetId === targetId).sort(byDate);
  const fields = [...new Set(proposalsOf(ctx, target).map(p => p.field))];
  const canModify = ctx.mode === 'cctp' && textFields.length > 0 && ctx.canProposeKind('cctp');
  const withFigures = ctx.mode === 'cctp' && !!ligne && ligne.quantite !== undefined && estFeuille(ligne) && ctx.canProposeKind('dpgf');

  return (
    <>
      <Thread comments={thread} />
      {ctx.annotate && fields.length > 0 && (
        <div className="mt-2 space-y-1">
          {fields.map(field => {
            const last = proposalsOf(ctx, target, field).at(-1)!;
            return (
              <div key={field} className="text-sm flex flex-wrap items-center gap-2">
                <StatusBadge status={last.status as BlockStatus} />
                <span className="text-[var(--tblr-muted)]">
                  {t(`shared_field_${field}`)}
                  {last.status === 'rejected' && last.decisionNote ? ` · ${t('shared_proposal_note', { note: last.decisionNote })}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {selected && withFigures && ligne && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--tblr-text)]">
          {figureAllowed(ligne, 'quantite') && <FigureCell ctx={ctx} lot={lot} ligne={ligne} field="quantite" />}
          <FigureCell ctx={ctx} lot={lot} ligne={ligne} field="unite" />
          <span aria-hidden="true">×</span>
          <FigureCell ctx={ctx} lot={lot} ligne={ligne} field="prixUnitaire" />
        </div>
      )}
      {selected && ligne?.pourMemoire && ctx.canProposeKind('dpgf') && <p className="mt-1 text-xs text-[var(--tblr-muted)]">{t('shared_pm_hint')}</p>}
      {selected && !open && (
        <div className="mt-3 flex flex-wrap gap-2">
          {ctx.canComment && <button type="button" onClick={() => setOpen('comment')} className="btn btn-secondary">{t('shared_comment_add')}</button>}
          {canModify && <button type="button" onClick={() => setOpen('modif')} className="btn btn-secondary">{t('shared_action_modify')}</button>}
          {ligne && <MetreButton ctx={ctx} lot={lot} ligne={ligne} />}
        </div>
      )}
      {selected && open === 'comment' && <CommentEditor ctx={ctx} target={target} label={label} onDone={() => setOpen(null)} />}
      {selected && open === 'modif' && <ModifEditor ctx={ctx} target={target} fields={textFields} onDone={() => setOpen(null)} />}
    </>
  );
}

/** Un passage du document : on le lit tel quel ; en mode annotation, un clic le sélectionne. */
function NodeBlock({ ctx, lot, targetType, targetId, level, numero, title, text, textFields, ligne }: {
  ctx: Ctx; lot: LotView; targetType: TargetType; targetId: string; level: 1 | 2 | 3;
  numero: string | null; title: string | null; text?: string | null; textFields?: EditField[]; ligne?: Ligne;
}) {
  const { t } = useTranslation();
  const nodeKey = nodeKeyOf(targetType, targetId);
  const status = ctx.annotate ? statusOfNode(ctx, { lotId: lot.projectLotId, targetType, targetId }) : null;
  const selected = ctx.annotate && ctx.selected === nodeKey;
  const pick = (e: React.SyntheticEvent) => {
    if (!ctx.annotate) return;
    if ((e.target as HTMLElement).closest('button,input,textarea,a,label,[role="dialog"]')) return;
    ctx.select(nodeKey);
  };
  const Heading = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
  const metre = ligne?.quantiteDetails ?? [];
  return (
    <article
      id={`node-${nodeKey}`}
      tabIndex={ctx.annotate ? 0 : undefined}
      onClick={pick}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && ctx.annotate) { e.preventDefault(); ctx.select(nodeKey); } }}
      className={`rounded px-4 py-2.5 -ml-4 max-w-[72ch] border-l-[3px] ${ctx.annotate ? 'cursor-pointer hover:bg-[var(--tblr-surface-2)]' : ''} focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--tblr-primary-lt)]`}
      style={{
        borderLeftColor: selected ? 'var(--tblr-primary)' : status ? `var(${STATUS_VAR[status]})` : 'transparent',
        background: selected ? 'var(--tblr-primary-lt)' : undefined,
      }}
    >
      <Heading className={`${level === 1 ? 'text-base' : level === 2 ? 'text-[0.9375rem]' : 'text-sm text-[var(--tblr-muted)]'} font-bold tracking-tight text-[var(--tblr-text)]`}>
        {numero && <span className="font-mono text-[0.8125rem] font-normal text-[var(--tblr-muted)] mr-2">{numero}</span>}
        {title}
        {ligne?.localisation ? <span className="text-xs font-normal text-[var(--tblr-muted)]"> · {ligne.localisation}</span> : null}
      </Heading>
      {text && <p className="text-[0.9375rem] leading-[1.7] whitespace-pre-wrap text-[var(--tblr-text)]">{texteBrut(text)}</p>}
      {ligne && ligne.quantite !== undefined && (
        <p className="text-xs text-[var(--tblr-muted)] mt-1">{ligne.pourMemoire ? t('shared_pm') : resumeChiffres(ligne)}</p>
      )}
      {metre.length > 0 && (
        <ul aria-label={t('shared_field_metre')} className="mt-1 text-xs rounded px-3 py-2 space-y-0.5 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)]">
          {metre.map(d => (
            <li key={d.id} className="flex justify-between gap-3">
              <span className="text-[var(--tblr-text)]">{d.libelle || [d.niveau, d.local].filter(Boolean).join(' · ') || '·'}</span>
              <span className="font-mono tabular-nums text-[var(--tblr-muted)]">{d.expression ?? num.format(d.quantite)}</span>
            </li>
          ))}
        </ul>
      )}
      <NodeExtras
        ctx={ctx} lot={lot} targetType={targetType} targetId={targetId} textFields={textFields} ligne={ligne}
        label={[numero, title].filter(Boolean).join(' ')}
      />
    </article>
  );
}

function LigneBlock({ ctx, lot, ligne, depth }: { ctx: Ctx; lot: LotView; ligne: Ligne; depth: number }) {
  const fields: EditField[] = ctx.mode === 'cctp'
    ? [{ field: 'designation', current: ligne.designation ?? '' }, { field: 'cctpDescription', current: ligne.cctpDescription ?? '', multiline: true }]
    : [];
  return (
    <div style={{ marginLeft: depth * 16 }}>
      <NodeBlock
        ctx={ctx} lot={lot} targetType="ligne" targetId={ligne.id} level={3} numero={ligne.numero} title={ligne.designation}
        text={ligne.cctpDescription} textFields={fields} ligne={ligne}
      />
      {ligne.children?.map(c => <LigneBlock key={c.id} ctx={ctx} lot={lot} ligne={c} depth={depth + 1} />)}
    </div>
  );
}

function CctpLot({ ctx, lot }: { ctx: Ctx; lot: LotView }) {
  return (
    <section className="space-y-1">
      <NodeBlock ctx={ctx} lot={lot} targetType="lot" targetId={lot.id} level={1} numero={lot.numero} title={lot.titre}
        textFields={[{ field: 'titre', current: lot.titre ?? '' }]} />
      {lot.chapitres.map(chap => (
        <div key={chap.id} className="space-y-1">
          <NodeBlock
            ctx={ctx} lot={lot} targetType="chapitre" targetId={chap.id} level={2} numero={chap.numero} title={chap.titre} text={chap.cctpDescription}
            textFields={[{ field: 'titre', current: chap.titre ?? '' }, { field: 'cctpDescription', current: chap.cctpDescription ?? '', multiline: true }]}
          />
          {chap.lignes.map(l => <LigneBlock key={l.id} ctx={ctx} lot={lot} ligne={l} depth={0} />)}
        </div>
      ))}
    </section>
  );
}

/** La ligne sous un élément du tableau : fil de commentaires, état des propositions et actions quand il est sélectionné. */
function ExtrasRow(props: { ctx: Ctx; lot: LotView; targetType: TargetType; targetId: string; label: string; ligne?: Ligne }) {
  const { ctx, lot, targetType, targetId } = props;
  const hasThread = ctx.comments.some(c => c.lotId === lot.projectLotId && c.targetType === targetType && c.targetId === targetId);
  const selected = ctx.annotate && ctx.selected === nodeKeyOf(targetType, targetId);
  if (!selected && !hasThread) return null;
  return <tr><td colSpan={6} className="!pt-0"><NodeExtras {...props} /></td></tr>;
}

/** Une ligne du tableau du DPGF ; une ligne sélectionnée déroule ses actions dans une ligne dessous. */
function DpgfRow({ ctx, lot, ligne, depth }: { ctx: Ctx; lot: LotView; ligne: Ligne; depth: number }) {
  const { t } = useTranslation();
  const nodeKey = nodeKeyOf('ligne', ligne.id);
  const selected = ctx.annotate && ctx.selected === nodeKey;
  const status = ctx.annotate ? statusOfNode(ctx, { lotId: lot.projectLotId, targetType: 'ligne', targetId: ligne.id }) : null;
  const chiffree = estFeuille(ligne) && ligne.quantite !== undefined;
  const metre = ligne.quantiteDetails ?? [];
  const pick = (e: React.MouseEvent) => {
    if (ctx.annotate && !(e.target as HTMLElement).closest('button,input,a,[role="dialog"]')) ctx.select(nodeKey);
  };
  return (
    <>
      <tr
        id={`node-${nodeKey}`} onClick={pick} className={ctx.annotate ? 'cursor-pointer' : ''}
        style={{ background: selected ? 'var(--tblr-primary-lt)' : undefined, boxShadow: status ? `inset 3px 0 0 var(${STATUS_VAR[status]})` : undefined }}
      >
        <td className="font-mono text-[0.8125rem] text-[var(--tblr-muted)] whitespace-nowrap">{ligne.numero}</td>
        <td style={{ paddingLeft: 12 + depth * 16 }}>
          {ligne.designation}
          {ligne.localisation ? <span className="text-xs text-[var(--tblr-muted)]"> · {ligne.localisation}</span> : null}
          {metre.length > 0 && (
            <ul aria-label={t('shared_field_metre')} className="mt-1 text-xs space-y-0.5 text-[var(--tblr-muted)]">
              {metre.map(d => (
                <li key={d.id} className="flex justify-between gap-3">
                  <span>{d.libelle || [d.niveau, d.local].filter(Boolean).join(' · ') || '·'}</span>
                  <span className="font-mono tabular-nums">{d.expression ?? num.format(d.quantite)}</span>
                </li>
              ))}
            </ul>
          )}
        </td>
        <td className="text-right">{chiffree ? <FigureCell ctx={ctx} lot={lot} ligne={ligne} field="unite" /> : ligne.unite}</td>
        <td className="text-right tabular-nums">{chiffree ? <FigureCell ctx={ctx} lot={lot} ligne={ligne} field="quantite" /> : null}</td>
        <td className="text-right tabular-nums">{chiffree ? <FigureCell ctx={ctx} lot={lot} ligne={ligne} field="prixUnitaire" /> : null}</td>
        <td className="text-right tabular-nums font-semibold">
          {ligne.pourMemoire ? <span className="italic font-normal text-[var(--tblr-muted)]">{t('shared_pm')}</span> : ligne.prixTotal != null ? eur.format(ligne.prixTotal) : ''}
        </td>
      </tr>
      <ExtrasRow ctx={ctx} lot={lot} targetType="ligne" targetId={ligne.id} label={`${ligne.numero ?? ''} ${ligne.designation ?? ''}`.trim()} ligne={ligne} />
      {ligne.children?.map(c => <DpgfRow key={c.id} ctx={ctx} lot={lot} ligne={c} depth={depth + 1} />)}
    </>
  );
}

function ChapterRows({ ctx, lot, chap }: { ctx: Ctx; lot: LotView; chap: Chapitre }) {
  const nodeKey = nodeKeyOf('chapitre', chap.id);
  const selected = ctx.annotate && ctx.selected === nodeKey;
  return (
    <>
      <tr
        id={`node-${nodeKey}`} className={ctx.annotate ? 'cursor-pointer' : ''}
        onClick={e => { if (ctx.annotate && !(e.target as HTMLElement).closest('button,input,a')) ctx.select(nodeKey); }}
        style={{ background: selected ? 'var(--tblr-primary-lt)' : 'var(--tblr-surface-2)' }}
      >
        <td className="font-mono text-[0.8125rem] text-[var(--tblr-muted)]">{chap.numero}</td>
        <td colSpan={5} className="font-bold">{chap.titre}</td>
      </tr>
      <ExtrasRow ctx={ctx} lot={lot} targetType="chapitre" targetId={chap.id} label={`${chap.numero ?? ''} ${chap.titre ?? ''}`.trim()} />
      {chap.lignes.map(l => <DpgfRow key={l.id} ctx={ctx} lot={lot} ligne={l} depth={0} />)}
    </>
  );
}

function DpgfLot({ ctx, lot }: { ctx: Ctx; lot: LotView }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <NodeBlock ctx={ctx} lot={lot} targetType="lot" targetId={lot.id} level={1} numero={lot.numero} title={lot.titre} />
      <div className="overflow-x-auto rounded-lg border border-[var(--tblr-border)]">
        <table className="tblr-table min-w-[640px]">
          <thead>
            <tr>
              <th>{t('shared_col_number')}</th><th>{t('shared_col_designation')}</th><th className="text-right">{t('shared_col_unit')}</th>
              <th className="text-right">{t('shared_col_qty')}</th><th className="text-right">{t('shared_col_price')}</th><th className="text-right">{t('shared_col_total')}</th>
            </tr>
          </thead>
          <tbody>
            {lot.chapitres.map(chap => <ChapterRows key={chap.id} ctx={ctx} lot={lot} chap={chap} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface FeedbackItem {
  id: string; status: BlockStatus; nodeKey: string; title: string; body: string; note?: string | null;
  onRemove?: () => void; error?: string;
}

function FeedbackPanel({ items, count, max, canSend, sending, drafts, onSend, onDiscard, onPick }: {
  items: FeedbackItem[]; count: number; max: number; canSend: boolean; sending: boolean; drafts: number;
  onSend: () => void; onDiscard: () => void; onPick: (nodeKey: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside aria-label={t('shared_feedback_title')} className="p-4 flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start lg:max-h-[78vh] lg:overflow-y-auto border-t lg:border-t-0 lg:border-l border-[var(--tblr-border)]">
      <h3 className={labelClass}>{t('shared_feedback_title')}</h3>
      <div>
        <p className={`text-xs ${count >= max * 0.8 ? 'font-semibold text-[var(--tblr-text)]' : 'text-[var(--tblr-muted)]'}`}>
          {t('shared_proposals_counter', { count, max })}
        </p>
        <div className="mt-1 h-1 rounded overflow-hidden border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)]">
          <div className="h-full bg-[var(--tblr-primary)]" style={{ width: `${Math.min(100, (count / max) * 100)}%` }} />
        </div>
      </div>
      {items.length === 0 && <p className="text-sm text-[var(--tblr-muted)]">{t('shared_feedback_empty')}</p>}
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item.id} className="rounded border border-[var(--tblr-border)] bg-[var(--tblr-surface)] px-3 py-2 text-sm">
            <button type="button" onClick={() => onPick(item.nodeKey)} className="block w-full text-left">
              <span className="block font-semibold text-[var(--tblr-text)]">{item.title}</span>
              <span className="block text-[var(--tblr-muted)] line-clamp-2">{item.body}</span>
            </button>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
              <StatusBadge status={item.status} />
              {item.onRemove && <button type="button" onClick={item.onRemove} className="text-xs underline text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]">{t('shared_proposal_withdraw')}</button>}
            </div>
            {item.note && <p className="mt-1 text-xs text-[var(--tblr-muted)]">{t('shared_proposal_note', { note: item.note })}</p>}
            {item.error && <p role="alert" className="mt-1 text-xs text-[var(--tblr-danger)]">{item.error}</p>}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-3 grid gap-2 border-t border-[var(--tblr-border)]">
        <button type="button" disabled={!canSend || sending} onClick={onSend} className="btn btn-primary">
          {drafts ? t('shared_feedback_send', { count: drafts }) : t('shared_feedback_send_none')}
        </button>
        {drafts > 0 && <button type="button" onClick={onDiscard} className="btn btn-ghost">{t('shared_feedback_discard')}</button>}
      </div>
    </aside>
  );
}

export default function SharedDocument({ projectId, mode, modes, grants, archived }: {
  projectId: string; mode?: Mode; modes?: Mode[]; grants: SharedGrant[]; archived: boolean;
}) {
  const { t } = useTranslation();
  const modesKey = (modes ?? (mode ? [mode] : [])).join(',');
  const list = useMemo(() => modesKey.split(',').filter(Boolean) as Mode[], [modesKey]);
  const [tab, setTab] = useState<Mode>(list[0]);
  const [docs, setDocs] = useState<Partial<Record<Mode, DocView>> | null>(null);
  const [comments, setComments] = useState<SharedComment[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ text: string; alert: boolean } | null>(null);
  const [annotateWanted, setAnnotateWanted] = useState(true);

  const loadComments = useCallback(
    () => apiFetch<SharedComment[]>(`/api/shared/projects/${projectId}/comments`).then(setComments),
    [projectId],
  );
  const loadProposals = useCallback(
    () => apiFetch<Proposal[]>(`/api/shared/projects/${projectId}/proposals`).then(setProposals),
    [projectId],
  );

  useEffect(() => {
    setDocs(null); setError(null); setDrafts([]); setSelected(null);
    const docsLoaded = Promise.all(list.map(m => apiFetch<DocView>(`/api/shared/projects/${projectId}/${m}`).then(d => [m, d] as const)));
    Promise.all([docsLoaded, loadComments(), loadProposals()])
      .then(([entries]) => setDocs(Object.fromEntries(entries)))
      .catch(e => setError(e?.message || t('share_error')));
  }, [projectId, list, loadComments, loadProposals, t]);

  const doc = docs?.[tab] ?? null;
  const pendingCount = proposals.filter(p => p.status === 'pending').length;
  const pendingLimit = proposals[0]?.limit ?? 50;
  // Un droit par atelier : le CCTP et le DPGF sont deux ateliers distincts. Un texte se propose avec le droit
  // du CCTP, une quantité ou un prix avec celui du DPGF, quelle que soit la vue d'où on les modifie.
  const canWriteAtelier = (kind: string) => !archived && grants.some(g => g.kind === kind && g.access === 'write');
  const canProposeAny = canWriteAtelier('cctp') || canWriteAtelier('dpgf');
  const canComment = !archived && grants.some(g => g.kind === tab && (g.access === 'comment' || g.access === 'write'));
  const canAnnotateAny = canProposeAny || (!archived && grants.some(g => list.includes(g.kind as Mode) && (g.access === 'comment' || g.access === 'write')));
  const annotate = canAnnotateAny && annotateWanted;

  // Le libellé de chaque élément, pour nommer ce que le confrère a proposé dans « Mes retours ».
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of Object.values(docs ?? {})) {
      for (const lot of d?.lots ?? []) {
        map.set(nodeKeyOf('lot', lot.id), `${lot.numero ?? ''} ${lot.titre ?? ''}`.trim());
        for (const chap of lot.chapitres) {
          map.set(nodeKeyOf('chapitre', chap.id), `${chap.numero ?? ''} ${chap.titre ?? ''}`.trim());
          const walk = (l: Ligne) => { map.set(nodeKeyOf('ligne', l.id), `${l.numero ?? ''} ${l.designation ?? ''}`.trim()); l.children?.forEach(walk); };
          chap.lignes.forEach(walk);
        }
      }
    }
    return map;
  }, [docs]);

  const addDraft = (draft: Draft): boolean => {
    if (!drafts.some(d => d.key === draft.key) && pendingCount + drafts.length >= pendingLimit) {
      setStatus({ text: t('shared_feedback_limit_local', { max: pendingLimit }), alert: true });
      return false;
    }
    setDrafts(prev => [...prev.filter(d => d.key !== draft.key), draft]);
    setStatus({ text: t('shared_draft_added'), alert: false });
    return true;
  };
  const removeDraft = (key: string) => setDrafts(prev => prev.filter(d => d.key !== key));

  const ctx: Ctx = {
    mode: tab, annotate, selected, select: setSelected,
    comments: comments.filter(c => c.resourceKind === tab), proposals, drafts,
    batiments: doc?.multiBatiments ? doc.batiments : undefined,
    canComment, canProposeKind: kind => canWriteAtelier(kind), addDraft, removeDraft,
  };

  // Tous les brouillons partent ensemble, dans l'ordre ; le premier refus arrête l'envoi, le reste demeure en brouillon.
  const sendAll = async () => {
    setSending(true); setStatus(null);
    let sent = 0;
    const remaining: Draft[] = [];
    let failure: string | null = null;
    for (const d of drafts) {
      if (failure) { remaining.push(d); continue; }
      try {
        if (d.kind === 'comment') {
          const parent = comments.filter(c => c.resourceKind === d.mode && c.lotId === d.target.lotId && c.targetType === d.target.targetType && c.targetId === d.target.targetId).sort(byDate)[0];
          await apiFetch(`/api/shared/projects/${projectId}/comments`, { method: 'POST', body: JSON.stringify({ resourceKind: d.mode, ...d.target, parentId: parent?.id, body: d.value }) });
        } else {
          await apiFetch(`/api/shared/projects/${projectId}/proposals`, { method: 'POST', body: JSON.stringify({ ...d.target, field: d.field, value: d.value }) });
        }
        sent++;
      } catch (e: any) {
        failure = e?.message || t('share_error');
        remaining.push({ ...d, error: failure! });
      }
    }
    setDrafts(remaining);
    try { await Promise.all([loadComments(), loadProposals()]); } catch { /* la liste se relira à la prochaine action */ }
    setStatus(failure
      ? { text: t('shared_feedback_partial', { sent, left: remaining.length, message: failure }), alert: true }
      : { text: t('shared_feedback_sent', { count: sent }), alert: false });
    setSending(false);
  };
  const withdraw = async (id: string) => {
    try {
      await apiFetch(`/api/shared/projects/${projectId}/proposals/${id}`, { method: 'DELETE' });
      await loadProposals();
    } catch (e: any) { setStatus({ text: e?.message || t('share_error'), alert: true }); }
  };

  // Le sommaire et « Mes retours » mènent à un élément : on change d'onglet si l'élément n'est que dans l'autre vue.
  const focusNode = (key: string) => {
    if (docs && !document.getElementById(`node-${key}`)) {
      const other = list.find(m => m !== tab && docs[m]);
      if (other) setTab(other);
    }
    setSelected(key); setScrollTo(key);
  };
  useEffect(() => {
    if (!scrollTo) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`node-${scrollTo}`)?.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    setScrollTo(null);
  }, [scrollTo, tab]);

  const items: FeedbackItem[] = [
    ...drafts.map((d): FeedbackItem => ({
      id: `draft:${d.key}`, status: 'draft', nodeKey: d.nodeKey, error: d.error,
      title: [d.kind === 'comment' ? t('shared_kind_comment') : t('shared_kind_modif'), labels.get(d.nodeKey)].filter(Boolean).join(' · '),
      body: d.kind === 'comment' ? `« ${d.value} »` : d.field === 'metre'
        ? t('shared_metre_lines', { count: metreLines(d.value) })
        : `${t(`shared_field_${d.field}`)} : ${short(d.base)} → ${short(d.value)}`,
      onRemove: () => removeDraft(d.key),
    })),
    ...[...proposals.filter(p => p.status !== 'withdrawn').sort(byDate).reduce((acc, p) => acc.set(`${p.targetType}:${p.targetId}:${p.field}`, p), new Map<string, Proposal>()).values()]
      .filter(p => labels.has(nodeKeyOf(p.targetType, p.targetId)))
      .map((p): FeedbackItem => ({
        id: `proposal:${p.id}`, status: p.status as BlockStatus, nodeKey: nodeKeyOf(p.targetType, p.targetId),
        note: p.status === 'rejected' ? p.decisionNote : null,
        title: [t('shared_kind_modif'), labels.get(nodeKeyOf(p.targetType, p.targetId))].filter(Boolean).join(' · '),
        body: p.field === 'metre' ? t('shared_metre_lines', { count: metreLines(p.proposedValue) }) : `${t(`shared_field_${p.field}`)} : ${short(p.proposedValue)}`,
        onRemove: p.status === 'pending' ? () => { void withdraw(p.id); } : undefined,
      })),
  ];

  if (error) return <p role="alert" className="text-sm text-[var(--tblr-danger)]">{error}</p>;
  if (!docs || !doc) return null;
  const version = doc.version ? ` · ${doc.version}` : '';
  const pill = (active: boolean) => `px-4 py-1.5 text-[0.8125rem] rounded-md ${active ? 'font-semibold text-[var(--tblr-text)] bg-[var(--tblr-surface)] shadow-[var(--tblr-shadow)]' : 'font-medium text-[var(--tblr-muted)]'}`;
  const track = 'inline-flex gap-0.5 p-1 rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)]';
  const dot = (s: BlockStatus | null, extra = '') => s && ctx.annotate
    ? <i className={`w-[7px] h-[7px] rounded-full shrink-0 ${extra}`} style={{ background: `var(${STATUS_VAR[s]})` }} />
    : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight text-[var(--tblr-text)]">
            {t(tab === 'cctp' ? 'shared_cctp_title' : 'shared_dpgf_title')}{version}
          </h2>
          {tab === 'dpgf' && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_prices_note')}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {list.length > 1 && (
            <div className={track} role="tablist">
              {list.map(m => (
                <button key={m} type="button" role="tab" aria-selected={m === tab} onClick={() => { setTab(m); setSelected(null); }} className={pill(m === tab)}>
                  {t(m === 'cctp' ? 'shared_cctp_title' : 'shared_dpgf_title')}
                </button>
              ))}
            </div>
          )}
          {canAnnotateAny && (
            <div className={track} role="group" aria-label={t('shared_mode_label')}>
              <button type="button" aria-pressed={!annotateWanted} onClick={() => { setAnnotateWanted(false); setSelected(null); }} className={pill(!annotateWanted)}>{t('shared_mode_read')}</button>
              <button type="button" aria-pressed={annotateWanted} onClick={() => setAnnotateWanted(true)} className={pill(annotateWanted)}>{t('shared_mode_annotate')}</button>
            </div>
          )}
        </div>
      </div>
      {canProposeAny && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_proposals_note')}</p>}
      {pendingCount >= pendingLimit && (
        <p role="alert" className="px-3 py-2 text-xs rounded text-[var(--tblr-danger)] border border-current">
          <span className="block font-semibold">{t('shared_proposals_limit_title')}</span>
          <span>{t('shared_proposals_limit_body', { count: pendingCount, max: pendingLimit })}</span>
        </p>
      )}
      {status && <p role={status.alert ? 'alert' : 'status'} className={`text-sm ${status.alert ? 'text-[var(--tblr-danger)]' : 'text-[var(--tblr-muted)]'}`}>{status.text}</p>}
      {doc.lots.length === 0 && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_doc_empty')}</p>}

      <div
        className={`grid grid-cols-1 ${annotate ? 'lg:grid-cols-[14rem_minmax(0,1fr)_18.75rem]' : 'lg:grid-cols-[14rem_minmax(0,1fr)]'} rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)]`}
        style={{ boxShadow: 'var(--tblr-shadow)' }}
      >
        <nav aria-label={t('shared_toc_title')} className="hidden lg:block p-3 lg:sticky lg:top-4 lg:self-start lg:max-h-[78vh] lg:overflow-y-auto border-r border-[var(--tblr-border)]">
          <h3 className={`${labelClass} mb-2`}>{t('shared_toc_title')}</h3>
          {doc.lots.map(lot => (
            <div key={lot.id}>
              <button type="button" onClick={() => focusNode(nodeKeyOf('lot', lot.id))} className="flex w-full items-center gap-2 px-3 py-1.5 rounded text-left text-[0.8125rem] font-medium text-[var(--tblr-primary)] bg-[var(--tblr-primary-lt)]">
                <span className="min-w-0 flex-1">{lot.numero} {lot.titre}</span>
                {dot(statusOfNode(ctx, { lotId: lot.projectLotId, targetType: 'lot', targetId: lot.id }))}
              </button>
              {lot.chapitres.map(chap => (
                <button key={chap.id} type="button" onClick={() => focusNode(nodeKeyOf('chapitre', chap.id))} className="flex w-full items-baseline gap-1.5 pl-6 pr-3 py-1 rounded text-left text-[0.8125rem] text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface-2)] hover:text-[var(--tblr-text)]">
                  <span className="font-mono text-xs min-w-[1.75rem]">{chap.numero}</span>
                  <span className="min-w-0 flex-1">{chap.titre}</span>
                  {dot(statusOfNode(ctx, { lotId: lot.projectLotId, targetType: 'chapitre', targetId: chap.id }), 'self-center')}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="min-w-0 px-4 py-6 sm:px-8 space-y-8">
          {tab === 'dpgf' && annotate && canWriteAtelier('dpgf') && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_figures_hint')}</p>}
          {doc.lots.map(lot => tab === 'cctp'
            ? <CctpLot key={lot.id} ctx={ctx} lot={lot} />
            : <DpgfLot key={lot.id} ctx={ctx} lot={lot} />)}
        </div>

        {annotate && (
          <FeedbackPanel
            items={items} count={pendingCount + drafts.length} max={pendingLimit} drafts={drafts.length}
            canSend={drafts.length > 0} sending={sending} onSend={() => { void sendAll(); }}
            onDiscard={() => { setDrafts([]); setStatus({ text: t('shared_feedback_discarded'), alert: false }); }}
            onPick={focusNode}
          />
        )}
      </div>
    </section>
  );
}
