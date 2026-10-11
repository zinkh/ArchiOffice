/**
 * Publication d'un extrait relu vers la bibliothèque Mistral : réservation en
 * base AVANT l'envoi, jamais de nouvel envoi à l'aveugle, suppression distante
 * garantie si le consentement est retiré en cours de route. Appelée par la route
 * (geste d'un administrateur) et par l'envoi automatique.
 */
import { createHash } from 'node:crypto';
import { makeMistralLibraryClient, resolveKnowledgeLibraryId } from './mistralLibrary';
import { processRemoteDeletion } from './mistralLifecycle';
import { anonymizeTechnicalText } from './anonymize';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface PublishOutcome { status: number; body: Record<string, unknown> }

export const publishEnabled = () => process.env.MISTRAL_KNOWLEDGE_PUBLISH_ENABLED === 'true';

export async function hasConsent(db: any, tenantId: string): Promise<boolean> {
  const { data, error } = await tenantScopedFrom(db, tenantId, 'knowledge_sharing_preferences')
    .select('opted_in').maybeSingle();
  if (error) throw error;
  return data?.opted_in === true;
}

export async function publishContribution(db: any, tenantId: string, contributionId: string): Promise<PublishOutcome> {
  if (!publishEnabled()) {
    return { status: 403, body: { error: 'Publication externe désactivée sur cette instance.' } };
  }
  if (!(await hasConsent(db, tenantId))) return { status: 403, body: { error: 'Consentement du cabinet absent.' } };
  const { data: contribution, error } = await tenantScopedFrom(db, tenantId, 'knowledge_contributions')
    .select('id,status,sanitized_text').eq('id', contributionId).maybeSingle();
  if (error) throw error;
  if (!contribution || contribution.status !== 'reviewed') {
    return { status: 409, body: { error: 'Seuls les extraits relus peuvent être publiés.' } };
  }
  const checked = anonymizeTechnicalText(contribution.sanitized_text);
  if (!contribution.sanitized_text.trim() || checked.text !== contribution.sanitized_text) {
    return { status: 409, body: { error: 'L’extrait nécessite une nouvelle anonymisation et relecture.', code: 'REANONYMIZE' } };
  }
  const key = process.env.MISTRAL_API_KEY;
  const libraryId = resolveKnowledgeLibraryId();
  if (!key) return { status: 503, body: { error: 'Clé API Mistral absente.' } };
  if (!libraryId) return { status: 503, body: { error: 'Bibliothèque Mistral non configurée sur cette instance.' } };
  const remoteName = 'archioffice-' + contribution.id + '.txt';
  const hash = createHash('sha256').update(contribution.sanitized_text).digest('hex');

  // UNIQUE(contribution_id) and a DB trigger protect against concurrent
  // sends, cross-tenant access and consent-withdrawal races.
  const reserved = await tenantScopedFrom(db, tenantId, 'knowledge_remote_documents')
    .insert({ contribution_id: contribution.id, library_id: libraryId, remote_name: remoteName,
      content_sha256: hash, state: 'uploading' }).select().single();
  if (reserved.error?.code === '23505') {
    return { status: 409, body: { error: 'Un transfert existe déjà pour cet extrait (envoyé, en rapprochement ou abandonné). Pour le republier, supprimez l’extrait puis préparez-le de nouveau.' } };
  }
  if (reserved.error?.code === '23514') {
    return { status: 409, body: { error: 'Consentement retiré ou contribution non validée.' } };
  }
  if (reserved.error) throw reserved.error;
  const job = reserved.data;
  const scope = tenantScopedFrom(db, tenantId, 'knowledge_remote_documents');
  const current = await scope.select('deletion_requested_at').eq('id', job.id).single();
  if (current.error) throw current.error;
  if (current.data?.deletion_requested_at || !(await hasConsent(db, tenantId))) {
    const cancelled = await scope.update({ state: 'deleted', deleted_at: new Date().toISOString() })
      .eq('id', job.id).eq('state', 'uploading');
    if (cancelled.error) throw cancelled.error;
    return { status: 409, body: { error: 'Transfert annulé : consentement retiré.' } };
  }

  let remote: { id: string };
  try {
    remote = await makeMistralLibraryClient(key, libraryId).upload(contribution.sanitized_text, contribution.id);
  } catch {
    // Remote success with a lost response is possible: do NOT retry upload.
    const uncertain = await scope.update({
      state: 'uncertain', last_error: 'Transfert non confirmé, rapprochement requis.',
      updated_at: new Date().toISOString(),
    }).eq('id', job.id).eq('state', 'uploading');
    if (uncertain.error) throw uncertain.error;
    return { status: 502, body: { error: 'Transfert Mistral non confirmé : vérification distante nécessaire.' } };
  }
  const saved = await scope.update({
    remote_document_id: remote.id, state: 'published',
    published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', job.id).eq('state', 'uploading').select().maybeSingle();
  if (saved.error || !saved.data) {
    return { status: 503, body: { error: 'Envoi distant réalisé, enregistrement local non confirmé. Ne pas réessayer le transfert.' } };
  }
  const stillAuthorized = await hasConsent(db, tenantId);
  if (!stillAuthorized || saved.data.deletion_requested_at) {
    const queued = await scope.update({
      deletion_requested_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', job.id).neq('state', 'deleted').select().single();
    if (queued.error) throw queued.error;
    const removed = await processRemoteDeletion(db, queued.data);
    return { status: removed ? 200 : 202, body: { published: false, deletion_pending: !removed, remote_document_id: remote.id } };
  }
  return { status: 201, body: { published: true, remote_document_id: remote.id } };
}
