/**
 * Ce que le cabinet voit du partage de ses extraits techniques : un état clair
 * pour chaque document, un résumé de ce qui a été masqué, et le texte envoyé avec
 * les passages masqués mis en évidence. Logique pure, testée.
 */

export interface Contribution {
  id: string; document_id: string;
  status: 'draft' | 'queued' | 'analyzing' | 'held' | 'reviewed';
  sanitized_text: string; warnings: string[]; created_at: string; reviewed_at?: string | null;
  origin?: 'manual' | 'auto'; review_mode?: 'human' | 'auto' | null;
  withheld?: { index: number; text: string; reasons: string[] }[];
  analysis?: ContributionAnalysis | null;
}

export interface ContributionAnalysis {
  paragraphs?: number; kept?: number; withheld?: number; dropped_low_content?: number;
  masked?: Record<string, number>; ai_findings?: number; ai_chunks?: number; known_values?: number;
  analysed_at?: string; attempts?: number; last_error?: string; reason?: string;
}

export interface Publication {
  contribution_id: string; remote_document_id: string | null; state: string;
  deletion_requested_at: string | null; deleted_at: string | null; created_at?: string; published_at?: string | null;
  delete_attempts?: number;
}

export type StageTone = 'neutral' | 'progress' | 'ok' | 'warn' | 'done';
export interface Stage { key: string; label: string; detail: string; tone: StageTone }

/** Aligné sur ALERT_AFTER_ATTEMPTS (server/knowledge/mistralLifecycle.ts). */
export const REPEATED_FAILURE_ATTEMPTS = 6;

/** L'état d'un document, dit en toutes lettres (jamais seulement par une couleur). */
export function stageOf(c: Contribution, p: Publication | undefined, publicationActive: boolean): Stage {
  if (p) {
    if (p.state === 'deleted') return { key: 'removed', label: 'Retiré', detail: 'Le texte a été supprimé de la bibliothèque Mistral.', tone: 'done' };
    if (p.deletion_requested_at || p.state === 'delete_pending' || p.state === 'deleting') {
      const stuck = (p.delete_attempts ?? 0) >= REPEATED_FAILURE_ATTEMPTS;
      return stuck
        ? { key: 'removal-stuck', label: 'Retrait en échec', detail: 'La suppression chez Mistral échoue de façon répétée. Les tentatives continuent ; contactez le support si cela dure.', tone: 'warn' }
        : { key: 'removing', label: 'Retrait en cours', detail: 'La suppression chez Mistral est en cours ; elle est retentée automatiquement.', tone: 'progress' };
    }
    if (p.state === 'published') return { key: 'sent', label: 'Envoyé', detail: 'Ce texte est dans la bibliothèque commune.', tone: 'ok' };
    return { key: 'sending', label: 'Envoi à vérifier', detail: 'L’envoi n’a pas pu être confirmé ; le suivi est conservé pour éviter tout doublon.', tone: 'warn' };
  }
  switch (c.status) {
    case 'queued': return { key: 'queued', label: 'En attente d’analyse', detail: 'Le document sera analysé dans quelques instants.', tone: 'progress' };
    case 'analyzing': return { key: 'analyzing', label: 'Analyse en cours', detail: 'Le texte est lu, masqué puis relu par l’IA.', tone: 'progress' };
    case 'held': return { key: 'held', label: 'Retenu, rien n’a été envoyé', detail: c.analysis?.reason || 'Rien de partageable sans risque.', tone: 'warn' };
    case 'draft': return { key: 'draft', label: 'Brouillon à relire', detail: 'Relisez l’extrait puis validez-le.', tone: 'neutral' };
    case 'reviewed':
      if (c.origin === 'auto') {
        return publicationActive
          ? { key: 'ready', label: 'Prêt à l’envoi', detail: 'L’envoi part automatiquement dans quelques instants.', tone: 'progress' }
          : { key: 'ready-off', label: 'En attente : envoi désactivé', detail: 'L’envoi est désactivé sur cette instance : rien ne quitte ArchiOffice.', tone: 'neutral' };
      }
      return { key: 'validated', label: 'Validé, non envoyé', detail: 'Extrait validé, pas encore envoyé.', tone: 'neutral' };
  }
}

const NAMES: Record<string, [string, string]> = {
  PERSONNE: ['personne', 'personnes'], ENTREPRISE: ['entreprise', 'entreprises'], CLIENT: ['client', 'clients'],
  CABINET: ['mention du cabinet', 'mentions du cabinet'], AFFAIRE: ['nom d’affaire', 'noms d’affaires'],
  OPERATION: ['nom d’opération', 'noms d’opérations'], ADRESSE: ['adresse', 'adresses'], COMMUNE: ['commune', 'communes'],
  LOCALISATION: ['localité', 'localités'], PARCELLE: ['parcelle', 'parcelles'], PERMIS: ['permis', 'permis'],
  MONTANT: ['montant', 'montants'], REFERENCE: ['référence', 'références'], EMAIL: ['e-mail', 'e-mails'],
  TELEPHONE: ['téléphone', 'téléphones'], SIRET: ['SIRET', 'SIRET'], SIREN: ['SIREN', 'SIREN'], IBAN: ['IBAN', 'IBAN'],
  COORDONNEES: ['coordonnée', 'coordonnées'], LIEN: ['lien', 'liens'], MENTION: ['mention étiquetée', 'mentions étiquetées'],
  DATE: ['date', 'dates'], AUTRE: ['autre élément', 'autres éléments'],
};

export function labelOfCategory(category: string, count = 1): string {
  const pair = NAMES[category];
  if (!pair) return category.toLowerCase();
  return count > 1 ? pair[1] : pair[0];
}

/** « 3 personnes, 2 adresses, 1 montant », du plus fréquent au moins fréquent. */
export function describeMasked(masked: Record<string, number> | undefined): string {
  const entries = Object.entries(masked || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return 'Aucun élément masqué';
  return entries.map(([category, n]) => `${n} ${labelOfCategory(category, n)}`).join(', ');
}

export function totalMasked(masked: Record<string, number> | undefined): number {
  return Object.values(masked || {}).reduce((sum, n) => sum + n, 0);
}

/** Phrase de bilan d'un document analysé. */
export function summaryOf(c: Contribution): string {
  const a = c.analysis;
  if (!a || a.paragraphs === undefined) return '';
  const parts = [`${a.kept ?? 0} paragraphe${(a.kept ?? 0) > 1 ? 's' : ''} sur ${a.paragraphs} partageable${(a.kept ?? 0) > 1 ? 's' : ''}`];
  if (a.withheld) parts.push(`${a.withheld} retenu${a.withheld > 1 ? 's' : ''} par prudence`);
  parts.push(`${totalMasked(a.masked)} élément${totalMasked(a.masked) > 1 ? 's' : ''} masqué${totalMasked(a.masked) > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

export interface TextSegment { text: string; masked: boolean; label?: string }

/** Découpe un texte pour mettre en évidence les balises de masquage, ex. [PERSONNE]. */
export function splitMasked(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[([A-ZÉ_ ]+)\]/g)) {
    if (match.index! > last) segments.push({ text: text.slice(last, match.index), masked: false });
    segments.push({ text: match[0], masked: true, label: labelOfCategory(match[1]) });
    last = match.index! + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), masked: false });
  return segments;
}

/** Date lisible, ou chaîne vide si absente ou illisible. */
export function dayOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
