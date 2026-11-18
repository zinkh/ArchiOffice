// CCTP ou DPGF d'une affaire partagée, côté confrère : les lots qui lui sont
// accordés, en lecture, avec des commentaires sur un lot, un chapitre ou un article
// quand le droit « commentaire » est accordé. Le serveur ne construit que ces lots
// (server/projectShares/documentView.ts) : cet écran n'a rien à masquer.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconChevronRight, IconMessage } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { texteBrut } from '../lib/cctpRichText';
import { batimentsDuMetre, serialiserMetre } from '../lib/quantites';
import { MetreDialog } from './pro/MetreDialog';
import type { Ligne as LigneDocument } from '../types/dpgf';

type Mode = 'cctp' | 'dpgf';
type TargetType = 'lot' | 'chapitre' | 'ligne';

export interface SharedGrant { kind: string; access: 'read' | 'comment' | 'write' }

interface Ligne {
  id: string; numero: string | null; designation: string | null; unite: string | null; localisation: string | null;
  cctpDescription: string | null;
  /** Chiffres : toujours dans la vue DPGF, et dans la vue CCTP des lots accordés (un seul droit par lot). */
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

/** Quel droit chaque champ demande : le même que côté serveur (FIELD_KIND, documentView.ts). */
const FIELD_KIND: Record<string, Mode> = {
  cctpDescription: 'cctp', titre: 'cctp', designation: 'cctp', quantite: 'dpgf', prixUnitaire: 'dpgf', unite: 'dpgf', metre: 'dpgf',
};

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const fieldClass = 'w-full px-3 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

interface NodeCtx {
  mode: Mode; comments: SharedComment[]; canCommentLot: (lot: LotView) => boolean;
  post: (target: { lotId: string; targetType: TargetType; targetId: string; parentId?: string }, body: string) => Promise<void>;
  proposals: Proposal[];
  /** Les bâtiments de l'opération, quand elle en a plusieurs. */
  batiments?: BatimentView[];
  /** Droit « écriture » (proposer) sur ce lot pour ce type de document, affaire non archivée. */
  canProposeKind: (lot: LotView, kind: Mode) => boolean;
  propose: (target: { lotId: string; targetType: TargetType; targetId: string; field: string }, value: string) => Promise<void>;
  withdraw: (proposalId: string) => Promise<void>;
}

const MULTILINE_FIELDS = new Set(['cctpDescription']);
const NUMERIC_FIELDS = new Set(['quantite', 'prixUnitaire']);

/**
 * Proposer de modifier UN champ d'un lot, d'un chapitre ou d'un article, et suivre le sort de sa
 * proposition. Le confrère n'écrit jamais dans le document : le cabinet valide. Ce qu'il a saisi
 * reste dans le formulaire tant que la proposition n'est pas enregistrée (refus, limite atteinte).
 */
function ProposeEdit({ ctx, lot, targetType, targetId, field, current }: {
  ctx: NodeCtx; lot: LotView; targetType: TargetType; targetId: string; field: string; current: string;
}) {
  const { t } = useTranslation();
  const own = ctx.proposals
    .filter(p => p.lotId === lot.projectLotId && p.targetType === targetType && p.targetId === targetId && p.field === field && p.status !== 'withdrawn')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const last = own[own.length - 1];
  const canPropose = ctx.canProposeKind(lot, FIELD_KIND[field]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; limit: boolean } | null>(null);
  if (!canPropose && !last) return null;

  const label = t(`shared_field_${field}`);
  const short = (value: string) => (value.length > 80 ? `${value.slice(0, 80)}…` : value || '—');
  const startEditing = () => { setText(last?.status === 'pending' ? last.proposedValue : current); setError(null); setOpen(true); };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await ctx.propose({ lotId: lot.projectLotId, targetType, targetId, field }, text);
      setOpen(false);
    } catch (e: any) {
      // Rien n'est effacé : le texte saisi reste dans le champ, y compris à la limite de propositions.
      setError({ message: e?.message || t('share_error'), limit: e?.code === 'PROPOSAL_LIMIT' });
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-1 space-y-1">
      {last && (
        <div className="text-xs rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2" style={{ background: 'var(--tblr-surface-2)' }}>
          <span className="text-[var(--tblr-text)]">
            <span className="font-semibold">{label} : </span>
            {last.status === 'pending' && t('shared_proposal_pending', { value: short(last.proposedValue) })}
            {last.status === 'applied' && t('shared_proposal_applied', { value: short(last.proposedValue) })}
            {last.status === 'rejected' && t('shared_proposal_rejected')}
            {last.status === 'outdated' && t('shared_proposal_outdated')}
            {last.status === 'rejected' && last.decisionNote ? ` · ${t('shared_proposal_note', { note: last.decisionNote })}` : ''}
          </span>
          {last.status === 'pending' && canPropose && (
            <button type="button" onClick={() => ctx.withdraw(last.id)} className="underline text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]">
              {t('shared_proposal_withdraw')}
            </button>
          )}
        </div>
      )}
      {canPropose && !open && (
        <button type="button" onClick={startEditing} className="text-xs font-medium text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] underline">
          {t('shared_propose', { field: label })}
        </button>
      )}
      {canPropose && open && (
        <form onSubmit={send} className="space-y-1">
          {MULTILINE_FIELDS.has(field) ? (
            <textarea rows={4} maxLength={20000} value={text} onChange={e => setText(e.target.value)} aria-label={label} className={fieldClass} />
          ) : (
            <input value={text} onChange={e => setText(e.target.value)} aria-label={label} className={fieldClass}
              inputMode={NUMERIC_FIELDS.has(field) ? 'decimal' : undefined} maxLength={300} />
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="px-3 py-1 text-xs font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50">
              {t('shared_proposal_send')}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1 text-xs font-medium text-[var(--tblr-muted)] underline">
              {t('shared_proposal_cancel')}
            </button>
          </div>
          {error && (
            <p role="alert" className={`text-xs ${error.limit ? 'px-3 py-2 rounded-lg font-semibold text-red-700 dark:text-red-400' : 'text-red-600'}`}
              style={error.limit ? { border: '1px solid currentColor' } : undefined}>
              {error.message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function NodeComments({ ctx, lot, targetType, targetId }: { ctx: NodeCtx; lot: LotView; targetType: TargetType; targetId: string }) {
  const { t } = useTranslation();
  const thread = ctx.comments
    .filter(c => c.resourceKind === ctx.mode && c.lotId === lot.projectLotId && c.targetType === targetType && c.targetId === targetId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const canComment = ctx.canCommentLot(lot);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!thread.length && !canComment) return null;

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await ctx.post({ lotId: lot.projectLotId, targetType, targetId, parentId: thread[0]?.id }, text);
      setText(''); setOpen(false);
    } catch (e: any) { setError(e?.message || t('share_error')); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-1 space-y-1">
      {thread.map(c => (
        <div key={c.id} className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--tblr-surface-2)' }}>
          <div className="text-[var(--tblr-muted)]">
            {c.authorKind === 'cabinet' ? t('shared_comment_cabinet') : t('shared_comment_you')}
            {c.createdAt ? ` · ${new Date(c.createdAt).toLocaleDateString('fr-FR')}` : ''}
            {c.resolvedAt ? ` · ${t('shared_comment_resolved')}` : ''}
          </div>
          <div className="text-[var(--tblr-text)] whitespace-pre-wrap">{c.body}</div>
        </div>
      ))}
      {canComment && !open && (
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] underline">
          {t('shared_comment_add')}
        </button>
      )}
      {canComment && open && (
        <form onSubmit={send} className="space-y-1">
          <textarea
            required rows={2} maxLength={2000} value={text} onChange={e => setText(e.target.value)}
            placeholder={t('shared_comment_placeholder')} aria-label={t('shared_comment_placeholder')} className={fieldClass}
          />
          <button type="submit" disabled={busy || !text.trim()} className="px-3 py-1 text-xs font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50">
            {t('shared_comment_send')}
          </button>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        </form>
      )}
    </div>
  );
}

/** « 12,5 m² × 48,50 € = 606,25 € » : ce que le confrère voit d'un article chiffré. */
function resumeChiffres(ligne: Ligne): string {
  return ligne.quantite != null && ligne.prixUnitaire != null
    ? `${num.format(ligne.quantite)} ${ligne.unite ?? ''} × ${eur.format(ligne.prixUnitaire)} = ${eur.format(ligne.prixTotal ?? 0)}`
    : '';
}

/**
 * Proposer un métré : la liste de lignes libellées dont la somme est la quantité de l'article. Une seule
 * proposition remplace la liste (le cabinet voit l'actuelle face à la proposée). La fenêtre est celle de
 * l'éditeur ; ce que le confrère a saisi reste dans la fenêtre tant que la proposition n'est pas enregistrée.
 */
function ProposeMetre({ ctx, lot, ligne }: { ctx: NodeCtx; lot: LotView; ligne: Ligne }) {
  const { t } = useTranslation();
  const canPropose = ctx.canProposeKind(lot, 'dpgf');
  const own = ctx.proposals
    .filter(p => p.lotId === lot.projectLotId && p.targetType === 'ligne' && p.targetId === ligne.id && p.field === 'metre' && p.status !== 'withdrawn')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const last = own[own.length - 1];
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canPropose && !last) return null;

  const lignes = (value: string): number => { try { const v = JSON.parse(value); return Array.isArray(v) ? v.length : 0; } catch { return 0; } };
  const label = t('shared_field_metre');
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

  const send = async (patch: Partial<LigneDocument>) => {
    setError(null);
    try {
      await ctx.propose({ lotId: lot.projectLotId, targetType: 'ligne', targetId: ligne.id, field: 'metre' }, serialiserMetre(patch.quantiteDetails ?? [], { parBatiment: !!batiments?.length }));
      setOpen(false);
    } catch (e: any) {
      // Rien n'est effacé : le métré saisi reste dans la fenêtre, y compris à la limite de propositions.
      setError(e?.message || t('share_error'));
    }
  };

  return (
    <div className="mt-1 space-y-1">
      {last && (
        <div className="text-xs rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2" style={{ background: 'var(--tblr-surface-2)' }}>
          <span className="text-[var(--tblr-text)]">
            <span className="font-semibold">{label} : </span>
            {last.status === 'pending' && t('shared_metre_pending', { lines: lignes(last.proposedValue) })}
            {last.status === 'applied' && t('shared_proposal_applied', { value: `${label} (${lignes(last.proposedValue)})` })}
            {last.status === 'rejected' && t('shared_proposal_rejected')}
            {last.status === 'outdated' && t('shared_proposal_outdated')}
            {last.status === 'rejected' && last.decisionNote ? ` · ${t('shared_proposal_note', { note: last.decisionNote })}` : ''}
          </span>
          {last.status === 'pending' && canPropose && (
            <button type="button" onClick={() => ctx.withdraw(last.id)} className="underline text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]">
              {t('shared_proposal_withdraw')}
            </button>
          )}
        </div>
      )}
      {canPropose && (
        <button type="button" onClick={() => { setError(null); setOpen(true); }} className="text-xs font-medium text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] underline">
          {t('shared_propose_metre')}
        </button>
      )}
      {open && (
        <MetreDialog
          ligne={pour} batiments={batiments} onClose={() => setOpen(false)} onSave={send}
          applyLabel={t('shared_proposal_send')} erreur={error}
        />
      )}
    </div>
  );
}

/**
 * Les chiffres d'un article, à proposer : la quantité (ou son métré, quand il en a un : la quantité est alors
 * la somme de ses lignes), le prix unitaire et l'unité. Même droit et mêmes règles dans le CCTP et dans le DPGF.
 */
function ChiffresBlock({ ctx, lot, ligne }: { ctx: NodeCtx; lot: LotView; ligne: Ligne }) {
  const { t } = useTranslation();
  const metre = ligne.quantiteDetails ?? [];
  return (
    <>
      {/* Un article « pour mémoire » accepte quantité, unité et prix ; un prix le fait entrer dans le total. */}
      {ligne.pourMemoire && ctx.canProposeKind(lot, 'dpgf') && <p className="mt-1 text-xs text-[var(--tblr-muted)]">{t('shared_pm_hint')}</p>}
      {metre.length > 0 && (
        <ul aria-label={t('shared_field_metre')} className="mt-1 text-xs rounded-lg px-3 py-2 space-y-0.5" style={{ background: 'var(--tblr-surface-2)' }}>
          {metre.map(d => (
            <li key={d.id} className="flex justify-between gap-3">
              <span className="text-[var(--tblr-text)]">{d.libelle || [d.niveau, d.local].filter(Boolean).join(' · ') || '·'}</span>
              <span className="font-mono tabular-nums text-[var(--tblr-muted)]">{d.expression ?? num.format(d.quantite)}</span>
            </li>
          ))}
        </ul>
      )}
      {/* Avec un métré, la quantité se modifie par le métré (le serveur refuse de la proposer seule). */}
      {metre.length === 0 && (
        <ProposeEdit ctx={ctx} lot={lot} targetType="ligne" targetId={ligne.id} field="quantite" current={ligne.quantite == null ? '' : String(ligne.quantite)} />
      )}
      <ProposeMetre ctx={ctx} lot={lot} ligne={ligne} />
      <ProposeEdit ctx={ctx} lot={lot} targetType="ligne" targetId={ligne.id} field="prixUnitaire" current={ligne.prixUnitaire == null ? '' : String(ligne.prixUnitaire)} />
      <ProposeEdit ctx={ctx} lot={lot} targetType="ligne" targetId={ligne.id} field="unite" current={ligne.unite ?? ''} />
    </>
  );
}

function LigneRow({ ctx, lot, ligne, depth }: { ctx: NodeCtx; lot: LotView; ligne: Ligne; depth: number }) {
  const { t } = useTranslation();
  const dpgf = ctx.mode === 'dpgf';
  // Chiffres : toujours dans la vue DPGF, et dans la vue CCTP d'un lot accordé (un seul droit par lot).
  const aChiffres = ligne.quantite !== undefined;
  return (
    <li style={{ marginLeft: depth * 12 }} className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-[var(--tblr-text)]">
          <span className="text-[var(--tblr-muted)]">{ligne.numero} </span>{ligne.designation}
          {ligne.localisation ? <span className="text-xs text-[var(--tblr-muted)]"> · {ligne.localisation}</span> : null}
        </span>
        {aChiffres && (
          <span className="text-xs whitespace-nowrap text-right text-[var(--tblr-muted)]">
            {ligne.pourMemoire ? t('shared_pm') : resumeChiffres(ligne)}
          </span>
        )}
      </div>
      {!dpgf && ligne.cctpDescription && (
        <p className="text-xs text-[var(--tblr-muted)] whitespace-pre-wrap mt-0.5">{texteBrut(ligne.cctpDescription)}</p>
      )}
      {!dpgf && (
        <>
          <ProposeEdit ctx={ctx} lot={lot} targetType="ligne" targetId={ligne.id} field="designation" current={ligne.designation ?? ''} />
          <ProposeEdit ctx={ctx} lot={lot} targetType="ligne" targetId={ligne.id} field="cctpDescription" current={ligne.cctpDescription ?? ''} />
        </>
      )}
      {/* Seulement sur une feuille chiffrée, comme l'éditeur (un parent porte la somme de ses enfants). */}
      {aChiffres && !ligne.children?.length && <ChiffresBlock ctx={ctx} lot={lot} ligne={ligne} />}
      <NodeComments ctx={ctx} lot={lot} targetType="ligne" targetId={ligne.id} />
      {ligne.children && ligne.children.length > 0 && (
        <ul>{ligne.children.map(c => <LigneRow key={c.id} ctx={ctx} lot={lot} ligne={c} depth={depth + 1} />)}</ul>
      )}
    </li>
  );
}

interface LigneAplatie { ligne: Ligne; depth: number }
const aplatir = (lignes: Ligne[], depth = 0): LigneAplatie[] =>
  lignes.flatMap(l => [{ ligne: l, depth }, ...aplatir(l.children ?? [], depth + 1)]);
const feuilles = (lignes: Ligne[]): Ligne[] => lignes.flatMap(l => (l.children?.length ? feuilles(l.children) : [l]));

/** Sous-total d'un lot : la somme de ses articles chiffrés (jamais un « pour mémoire »), recalculée depuis les lignes vues. */
function sousTotalLot(lot: LotView): number | null {
  const chiffrees = lot.chapitres.flatMap(c => feuilles(c.lignes)).filter(l => l.quantite !== undefined);
  return chiffrees.length === 0 ? null : chiffrees.reduce((somme, l) => somme + (l.pourMemoire ? 0 : l.prixTotal ?? 0), 0);
}

/**
 * Plan du CCTP, à gauche de la feuille : les lots et leurs chapitres, comme l'arbre de l'éditeur. Un clic
 * amène à l'endroit du document ; rien n'est masqué, la feuille reste lisible d'un bout à l'autre.
 */
function CctpOutline({ doc }: { doc: DocView }) {
  const { t } = useTranslation();
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <nav aria-label={t('shared_outline')} className="hidden lg:block lg:sticky lg:top-4 lg:max-h-[calc(100dvh-8rem)] overflow-y-auto self-start rounded-lg p-2 text-sm"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
      <ul className="space-y-0.5">
        {doc.lots.map(lot => (
          <li key={lot.id}>
            <button type="button" onClick={() => go(`cctp-lot-${lot.id}`)}
              className="w-full text-left px-2 py-1 rounded-md font-semibold hover:bg-[var(--tblr-surface-2)] text-[var(--tblr-text)]">
              <span className="font-mono text-xs text-[var(--tblr-muted)]">{lot.numero}</span> {lot.titre}
            </button>
            <ul className="ml-3 pl-2 space-y-0.5" style={{ borderLeft: '1px solid var(--tblr-border)' }}>
              {lot.chapitres.map(chap => (
                <li key={chap.id}>
                  <button type="button" onClick={() => go(`cctp-chap-${chap.id}`)}
                    className="w-full text-left px-2 py-0.5 rounded-md text-xs hover:bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]">
                    {chap.numero} {chap.titre}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Le DPGF du confrère en grille, comme dans l'éditeur : lots, chapitres et articles en lignes, colonnes
 * unité, quantité, prix unitaire et total. Un clic sur une ligne en ouvre le détail (propositions, métré,
 * commentaires) : la grille reste lisible, les gestes d'écriture sont à portée.
 */
function DpgfGrid({ ctx, doc }: { ctx: NodeCtx; doc: DocView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen(current => (current === key ? null : key));
  const COLS = 7;
  const activite = (type: TargetType, id: string) =>
    ctx.comments.filter(c => c.resourceKind === ctx.mode && c.targetType === type && c.targetId === id).length
    + ctx.proposals.filter(p => p.targetType === type && p.targetId === id && p.status === 'pending').length;

  const bouton = (key: string, type: TargetType, id: string) => {
    const n = activite(type, id);
    return (
      <button type="button" aria-expanded={open === key} aria-label={t('shared_row_details')} title={t('shared_row_details')} onClick={() => toggle(key)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface-2)] hover:text-[var(--tblr-text)]">
        {open === key ? <IconChevronDown size={14} aria-hidden /> : <IconChevronRight size={14} aria-hidden />}
        {n > 0 && <span className="inline-flex items-center gap-0.5 text-[0.6875rem] font-semibold"><IconMessage size={12} aria-hidden />{n}</span>}
      </button>
    );
  };
  const detail = (key: string, content: React.ReactNode) => open === key && (
    <tr key={`${key}-detail`}><td colSpan={COLS} className="px-4 py-2" style={{ background: 'var(--tblr-surface-2)' }}>{content}</td></tr>
  );
  const cell = 'px-2 py-1.5 align-top';

  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
      <table className="w-full text-sm border-collapse" style={{ minWidth: 720 }}>
        <thead>
          <tr className="text-xs text-left" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
            <th scope="col" className="px-2 py-2 w-20 font-semibold">{t('shared_col_numero')}</th>
            <th scope="col" className="px-2 py-2 font-semibold">{t('shared_col_designation')}</th>
            <th scope="col" className="px-2 py-2 w-16 text-center font-semibold">{t('shared_col_unite')}</th>
            <th scope="col" className="px-2 py-2 w-24 text-right font-semibold">{t('shared_col_quantite')}</th>
            <th scope="col" className="px-2 py-2 w-28 text-right font-semibold">{t('shared_col_pu')}</th>
            <th scope="col" className="px-2 py-2 w-32 text-right font-semibold">{t('shared_col_total')}</th>
            <th scope="col" className="px-2 py-2 w-16"><span className="sr-only">{t('shared_row_details')}</span></th>
          </tr>
        </thead>
        <tbody>
          {doc.lots.map(lot => {
            const total = sousTotalLot(lot);
            return (
              <Fragment key={lot.id}>
                <tr className="font-bold" style={{ background: 'var(--tblr-surface-2)', borderTop: '1px solid var(--tblr-border)' }}>
                  <td className={cell}>{lot.numero}</td>
                  <td className={cell} colSpan={4}>{lot.titre}</td>
                  <td className={`${cell} text-right font-mono tabular-nums`}>{total == null ? '' : eur.format(total)}</td>
                  <td className={`${cell} text-right`}>{bouton(`lot:${lot.id}`, 'lot', lot.id)}</td>
                </tr>
                {detail(`lot:${lot.id}`, <NodeComments ctx={ctx} lot={lot} targetType="lot" targetId={lot.id} />)}
                {lot.chapitres.map(chap => (
                  <Fragment key={chap.id}>
                    <tr className="font-semibold" style={{ borderTop: '1px solid var(--tblr-border)' }}>
                      <td className={cell}>{chap.numero}</td>
                      <td className={cell} colSpan={5}>{chap.titre}</td>
                      <td className={`${cell} text-right`}>{bouton(`chap:${chap.id}`, 'chapitre', chap.id)}</td>
                    </tr>
                    {detail(`chap:${chap.id}`, <NodeComments ctx={ctx} lot={lot} targetType="chapitre" targetId={chap.id} />)}
                    {aplatir(chap.lignes).map(({ ligne, depth }) => {
                      const key = `ligne:${ligne.id}`;
                      const chiffre = ligne.quantite !== undefined;
                      const feuille = !ligne.children?.length;
                      return (
                        <Fragment key={ligne.id}>
                          <tr style={{ borderTop: '1px solid var(--tblr-border)' }}>
                            <td className={`${cell} text-xs text-[var(--tblr-muted)]`}>{ligne.numero}</td>
                            <td className={cell} style={{ paddingLeft: 8 + depth * 14 }}>
                              {ligne.designation}
                              {ligne.localisation ? <span className="text-xs text-[var(--tblr-muted)]"> · {ligne.localisation}</span> : null}
                            </td>
                            <td className={`${cell} text-center`}>{chiffre ? ligne.unite : ''}</td>
                            <td className={`${cell} text-right font-mono tabular-nums`}>{chiffre && ligne.quantite != null ? num.format(ligne.quantite) : ''}</td>
                            <td className={`${cell} text-right font-mono tabular-nums`}>{chiffre && ligne.prixUnitaire != null ? eur.format(ligne.prixUnitaire) : ''}</td>
                            <td className={`${cell} text-right font-mono tabular-nums`}>
                              {chiffre ? (ligne.pourMemoire ? t('shared_pm') : eur.format(ligne.prixTotal ?? 0)) : ''}
                            </td>
                            <td className={`${cell} text-right`}>{bouton(key, 'ligne', ligne.id)}</td>
                          </tr>
                          {detail(key, (
                            <>
                              {chiffre && feuille && <ChiffresBlock ctx={ctx} lot={lot} ligne={ligne} />}
                              <NodeComments ctx={ctx} lot={lot} targetType="ligne" targetId={ligne.id} />
                            </>
                          ))}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function SharedDocument({ projectId, mode, grants, archived }: {
  projectId: string; mode: Mode; grants: SharedGrant[]; archived: boolean;
}) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<DocView | null>(null);
  const [comments, setComments] = useState<SharedComment[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(
    () => apiFetch<SharedComment[]>(`/api/shared/projects/${projectId}/comments`).then(setComments),
    [projectId],
  );
  const loadProposals = useCallback(
    () => apiFetch<Proposal[]>(`/api/shared/projects/${projectId}/proposals`).then(setProposals),
    [projectId],
  );

  useEffect(() => {
    setDoc(null); setError(null);
    Promise.all([apiFetch<DocView>(`/api/shared/projects/${projectId}/${mode}`), loadComments(), loadProposals()])
      .then(([d]) => setDoc(d))
      .catch(e => setError(e?.message || t('share_error')));
  }, [projectId, mode, loadComments, loadProposals, t]);

  const pendingCount = proposals.filter(p => p.status === 'pending').length;
  const pendingLimit = proposals[0]?.limit ?? 50;
  // Un droit par atelier : le CCTP et le DPGF sont deux ateliers distincts. Un texte se propose avec le droit
  // du CCTP, une quantité ou un prix avec celui du DPGF, quelle que soit la vue d'où on les modifie.
  const canWriteAtelier = (kind: string) => !archived && grants.some(g => g.kind === kind && g.access === 'write');
  const canProposeAny = canWriteAtelier('cctp') || canWriteAtelier('dpgf');

  const ctx: NodeCtx = {
    mode, comments, proposals,
    batiments: doc?.multiBatiments ? doc.batiments : undefined,
    canProposeKind: (_lot, kind) => canWriteAtelier(kind),
    propose: async (target, value) => {
      await apiFetch(`/api/shared/projects/${projectId}/proposals`, { method: 'POST', body: JSON.stringify({ ...target, value }) });
      await loadProposals();
    },
    withdraw: async proposalId => {
      await apiFetch(`/api/shared/projects/${projectId}/proposals/${proposalId}`, { method: 'DELETE' });
      await loadProposals();
    },
    canCommentLot: () => !archived && grants.some(g => g.kind === mode && (g.access === 'comment' || g.access === 'write')),
    post: async (target, body) => {
      await apiFetch(`/api/shared/projects/${projectId}/comments`, { method: 'POST', body: JSON.stringify({ resourceKind: mode, ...target, body }) });
      await loadComments();
    },
  };

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!doc) return null;
  return (
    <section className="rounded-lg p-4 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <div>
        <h2 className="text-sm font-bold text-[var(--tblr-text)]">
          {t(mode === 'cctp' ? 'shared_cctp_title' : 'shared_dpgf_title')}{doc.version ? ` · ${doc.version}` : ''}
        </h2>
        {mode === 'dpgf' && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_prices_note')}</p>}
      </div>
      {canProposeAny && (
        <div className="space-y-1">
          <p className="text-xs text-[var(--tblr-muted)]">{t('shared_proposals_note')}</p>
          {pendingCount > 0 && (
            <p className={`text-xs ${pendingCount >= pendingLimit * 0.8 ? 'font-semibold text-[var(--tblr-text)]' : 'text-[var(--tblr-muted)]'}`}>
              {t('shared_proposals_counter', { count: pendingCount, max: pendingLimit })}
            </p>
          )}
          {pendingCount >= pendingLimit && (
            <p role="alert" className="px-3 py-2 text-xs rounded-lg text-red-700 dark:text-red-400" style={{ border: '1px solid currentColor' }}>
              <span className="block font-semibold">{t('shared_proposals_limit_title')}</span>
              <span>{t('shared_proposals_limit_body', { count: pendingCount, max: pendingLimit })}</span>
            </p>
          )}
        </div>
      )}
      {doc.lots.length === 0 && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_doc_empty')}</p>}
      {mode === 'dpgf' && doc.lots.length > 0 && <DpgfGrid ctx={ctx} doc={doc} />}
      {mode === 'cctp' && doc.lots.length > 0 && (
      <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-4">
      <CctpOutline doc={doc} />
      <div className="space-y-6 min-w-0">
      {doc.lots.map(lot => (
        <div key={lot.id} id={`cctp-lot-${lot.id}`} className="space-y-2 scroll-mt-4">
          <h3 className="text-base font-bold text-[var(--tblr-text)]">{lot.numero} {lot.titre}</h3>
          {mode === 'cctp' && <ProposeEdit ctx={ctx} lot={lot} targetType="lot" targetId={lot.id} field="titre" current={lot.titre ?? ''} />}
          <NodeComments ctx={ctx} lot={lot} targetType="lot" targetId={lot.id} />
          {lot.chapitres.map(chap => (
            <div key={chap.id} id={`cctp-chap-${chap.id}`} className="pl-3 scroll-mt-4" style={{ borderLeft: '2px solid var(--tblr-border)' }}>
              <h4 className="text-sm font-semibold text-[var(--tblr-text)]">{chap.numero} {chap.titre}</h4>
              {mode === 'cctp' && chap.cctpDescription && (
                <p className="text-xs text-[var(--tblr-muted)] whitespace-pre-wrap">{texteBrut(chap.cctpDescription)}</p>
              )}
              {mode === 'cctp' && (
                <>
                  <ProposeEdit ctx={ctx} lot={lot} targetType="chapitre" targetId={chap.id} field="titre" current={chap.titre ?? ''} />
                  <ProposeEdit ctx={ctx} lot={lot} targetType="chapitre" targetId={chap.id} field="cctpDescription" current={chap.cctpDescription ?? ''} />
                </>
              )}
              <NodeComments ctx={ctx} lot={lot} targetType="chapitre" targetId={chap.id} />
              <ul>{chap.lignes.map(l => <LigneRow key={l.id} ctx={ctx} lot={lot} ligne={l} depth={0} />)}</ul>
            </div>
          ))}
        </div>
      ))}
      </div>
      </div>
      )}
    </section>
  );
}
