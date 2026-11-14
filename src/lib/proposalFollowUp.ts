export interface ProposalFollowUpSource {
  status?: string; sent_at?: string | null; archived_at?: string | null;
  last_response_at?: string | null; last_reminder_at?: string | null;
  next_follow_up_at?: string | null; signature_status?: string | null;
}
export const PROPOSAL_REMINDER_DAYS = 14;
export const PROPOSAL_ARCHIVE_DAYS = 60;
/** Au bout d'un mois sans réponse, un rappel téléphonique est mis au journal des appels. */
export const PROPOSAL_CALLBACK_DAYS = 30;
export function followUpDate(from: string, days = PROPOSAL_REMINDER_DAYS): string {
  return new Date(Date.parse(from) + days * 86400000).toISOString();
}
export function awaitingProposalReply(p: ProposalFollowUpSource): boolean {
  return p.status === 'Sent' && !p.archived_at && !p.last_response_at && p.signature_status !== 'completed';
}
export function proposalReminderDue(p: ProposalFollowUpSource, now = Date.now()): boolean {
  if (!awaitingProposalReply(p)) return false;
  const date = p.next_follow_up_at || (p.sent_at ? followUpDate(p.last_reminder_at || p.sent_at) : null);
  return !!date && Date.parse(date) <= now;
}
/** Envoyée depuis un mois ou plus, sans réponse ni signature : le client est à rappeler par téléphone. */
export function proposalCallbackDue(p: ProposalFollowUpSource, now = Date.now()): boolean {
  if (!awaitingProposalReply(p) || !p.sent_at) return false;
  const sent = Date.parse(p.sent_at);
  return Number.isFinite(sent) && sent + PROPOSAL_CALLBACK_DAYS * 86400000 <= now;
}
export function canArchiveProposal(p: ProposalFollowUpSource): boolean {
  return awaitingProposalReply(p) && !['creating', 'unknown', 'draft', 'inprogress', 'submitted'].includes(p.signature_status || '');
}
export function proposalArchiveDue(p: ProposalFollowUpSource, now = Date.now()): boolean {
  return canArchiveProposal(p) && !!p.sent_at && Date.parse(followUpDate(p.sent_at, PROPOSAL_ARCHIVE_DAYS)) <= now;
}
export const PROPOSAL_TRACKING_FIELDS = [
  'sent_at', 'archived_at', 'archive_reason', 'last_response_at', 'last_reminder_at', 'next_follow_up_at', 'reminder_count',
  'signature_provider', 'signature_request_id', 'signature_status', 'signature_recipient_email', 'signature_recipient_name',
  'signature_sent_at', 'signature_completed_at', 'signature_provider_region',
  'callback_call_id', 'callback_created_at',
] as const;
export function stripProposalTracking(input: Record<string, any>): Record<string, any> {
  const data = { ...input };
  for (const field of PROPOSAL_TRACKING_FIELDS) delete data[field];
  return data;
}
