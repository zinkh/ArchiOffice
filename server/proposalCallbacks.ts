// Rappel téléphonique des propositions restées sans réponse après un mois.
//
// Une proposition envoyée depuis 30 jours ou plus, sans réponse ni signature ni archivage,
// met au journal des appels (`phone_calls`) un appel SORTANT à passer au client, et la tâche
// de suivi qui va avec (même construction que `POST /api/phone-calls/:id/task`, via
// `buildTaskFromCall`). L'appel est attribué à un administrateur du cabinet, qui est prévenu.
//
// Même patron que les relances DOE et les rappels de réserves :
//   - cycle périodique, premier passage différé, inactif en mode hors ligne ;
//   - le rappel est « pris » par une mise à jour conditionnelle de `proposals.callback_call_id` :
//     deux processus (ou deux cycles qui se chevauchent) ne créent jamais deux appels ;
//   - jamais pour un cabinet suspendu ;
//   - une seule fois par proposition : `callback_call_id` reste posé, même si l'appel est traité.
// Instance non migrée (colonne ou table absente) : rien ne se passe, sans bruit.
import { randomUUID } from 'crypto';
import { loadSuspendedTenants } from './tenantSuspension';
import { notifyUsers } from './push';
import { buildTaskFromCall } from './routes/phoneCalls';
import { PROPOSAL_CALLBACK_DAYS, proposalCallbackDue } from '../src/lib/proposalFollowUp';

const INTERVALLE_CYCLE_HEURES = 6;
const JOUR_MS = 24 * 60 * 60 * 1000;
const MAX_PAR_CYCLE = 100;

export interface BilanRappelsPropositions { candidates: number; crees: number; echecs: number }

/** Interlocuteur : fiche contact, à défaut les champs saisis sur la proposition. */
function clientDe(p: any, contact: any): { name: string | null; company: string | null; phone: string | null; email: string | null } {
  const fullName = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ').trim();
  return {
    name: fullName || p.representant || null,
    company: p.is_entreprise ? (p.nom_societe || null) : (contact?.company || null),
    phone: p.portable || p.telephone || contact?.phone_mobile || contact?.phone || null,
    email: p.email_client || contact?.email || contact?.email_work || null,
  };
}

/** Premier administrateur du cabinet : il reçoit l'appel et la tâche. Aucun administrateur : appel non attribué. */
async function administrateurDuCabinet(supabaseAdmin: any, tenantId: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin.from('tenant_memberships').select('user_id').eq('tenant_id', tenantId).eq('system_role', 'admin').limit(1);
    return (data as any[] | null)?.[0]?.user_id ?? null;
  } catch { return null; }
}

async function creerRappel(supabaseAdmin: any, p: any, maintenant: Date): Promise<boolean> {
  const tenantId = p.tenant_id as string;
  const callId = randomUUID();
  const taskId = randomUUID();
  const today = maintenant.toISOString().slice(0, 10);

  // Prise du rappel : seule la mise à jour qui voit encore `callback_call_id` vide réussit.
  const { data: prise } = await supabaseAdmin.from('proposals')
    .update({ callback_call_id: callId, callback_created_at: maintenant.toISOString() })
    .eq('id', p.id).eq('tenant_id', tenantId).eq('status', 'Sent').is('callback_call_id', null).is('archived_at', null).is('last_response_at', null)
    .select('id');
  if (!prise?.length) return false;

  try {
    let contact: any = null;
    if (p.client_id) {
      const { data } = await supabaseAdmin.from('contacts').select('*').eq('id', p.client_id).eq('tenant_id', tenantId).maybeSingle();
      contact = data;
    }
    const client = clientDe(p, contact);
    const assignee = await administrateurDuCabinet(supabaseAdmin, tenantId);
    const sentOn = new Date(p.sent_at).toLocaleDateString('fr-FR');
    const ref = [p.reference, p.title].filter(Boolean).join(' · ');

    const call = {
      id: callId, tenant_id: tenantId, direction: 'sortant', called_at: maintenant.toISOString(),
      caller_name: client.name, caller_company: client.company, caller_phone: client.phone, caller_email: client.email,
      contact_id: p.client_id || null, project_id: null,
      subject: `Relance téléphonique : proposition ${p.reference || p.title}`,
      notes: `La proposition ${ref} a été envoyée le ${sentOn}, sans réponse depuis ${PROPOSAL_CALLBACK_DAYS} jours. À rappeler pour savoir si le client donne suite.`,
      assignee_id: assignee, status: 'en_cours', priority: 'normal', callback_due: today,
      task_id: null as string | null, created_by: null,
    };
    // L'appel d'abord (la tâche le référence), puis la tâche, puis le lien de l'appel vers sa tâche.
    const { error: callError } = await supabaseAdmin.from('phone_calls').insert(call);
    if (callError) throw callError;

    const { error: taskError } = await supabaseAdmin.from('tasks').insert({
      id: taskId, tenant_id: tenantId, ...buildTaskFromCall(call, today),
      progress: 0, dependencies: JSON.stringify([]), status: 'todo', created_by: null,
    });
    if (taskError) {
      // L'appel existe sans sa tâche : on le retire pour rejouer proprement au prochain cycle.
      await supabaseAdmin.from('phone_calls').delete().eq('id', callId).eq('tenant_id', tenantId);
      throw taskError;
    }
    await supabaseAdmin.from('phone_calls').update({ task_id: taskId }).eq('id', callId).eq('tenant_id', tenantId);

    if (assignee) {
      await notifyUsers(supabaseAdmin, tenantId, [assignee], {
        title: 'Proposition sans réponse : client à rappeler',
        body: [client.name || client.company, p.reference, p.title].filter(Boolean).join(' · ').slice(0, 200),
        url: `/appels?open=${encodeURIComponent(callId)}`,
        category: 'Tâches',
        tag: `proposal-callback:${p.id}`,
      });
    }
    return true;
  } catch (err: any) {
    // Libère la prise : le prochain cycle réessaiera.
    await supabaseAdmin.from('proposals').update({ callback_call_id: null, callback_created_at: null }).eq('id', p.id).eq('tenant_id', tenantId);
    throw err;
  }
}

export async function executerRappelsPropositions(supabaseAdmin: any, maintenant: Date = new Date()): Promise<BilanRappelsPropositions> {
  const bilan: BilanRappelsPropositions = { candidates: 0, crees: 0, echecs: 0 };
  const limite = new Date(maintenant.getTime() - PROPOSAL_CALLBACK_DAYS * JOUR_MS).toISOString();
  const { data: propositions, error } = await supabaseAdmin.from('proposals').select('*')
    .eq('status', 'Sent').is('archived_at', null).is('last_response_at', null).is('callback_call_id', null).lte('sent_at', limite)
    .order('sent_at', { ascending: true }).limit(MAX_PAR_CYCLE);
  // Colonne absente (instance non migrée) : rien à faire, sans bruit.
  if (error || !propositions?.length) return bilan;

  const suspendus = await loadSuspendedTenants(supabaseAdmin);
  for (const p of propositions as any[]) {
    if (suspendus.has(p.tenant_id) || !proposalCallbackDue(p, maintenant.getTime())) continue;
    bilan.candidates += 1;
    try {
      if (await creerRappel(supabaseAdmin, p, maintenant)) bilan.crees += 1;
    } catch (err: any) {
      bilan.echecs += 1;
      console.error('[rappels-propositions] Proposition en échec :', p.id, err?.message);
    }
  }
  return bilan;
}

/** Cycle périodique, même patron que server/reserveReminders.ts. Inactif en mode hors ligne. */
export function startProposalCallbacks(supabaseAdmin: any): void {
  if (process.env.OFFLINE_MODE === 'true') return;
  const heures = parseInt(process.env.PROPOSAL_CALLBACKS_INTERVAL_HOURS || '', 10) || INTERVALLE_CYCLE_HEURES;
  const cycle = () => executerRappelsPropositions(supabaseAdmin).catch(e => console.error('[rappels-propositions] Cycle en échec :', e?.message));
  // Premier passage différé : le serveur doit être à l'écoute avant d'écrire quoi que ce soit.
  setTimeout(cycle, 120_000).unref?.();
  setInterval(cycle, heures * 60 * 60 * 1000).unref?.();
}
