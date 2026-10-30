// Rappels hebdomadaires automatiques des réserves non levées (OPR et GPA).
//
// Un réglage par opération et par type de réserves (`reserve_reminder_settings`, activé depuis la
// fenêtre « Diffusion et export »). Tous les `interval_days` jours (7 par défaut), chaque ENTREPRISE
// reçoit la liste de SES réserves non levées, en retard d'abord ; rien n'est envoyé quand tout est levé.
// Les intervenants ne reçoivent pas de rappel automatique : ils ont le rapport complet à la demande.
//
// Même patron que les relances DOE (server/doe/relances.ts) :
//   - cycle périodique, premier passage différé, inactif en mode hors ligne ;
//   - l'échéance est « prise » par une mise à jour conditionnelle de `last_run_at` : deux processus
//     (ou deux cycles qui se chevauchent) n'envoient pas deux fois le même rappel ;
//   - jamais pour un cabinet suspendu ni une affaire archivée ;
//   - envoi par le SMTP du cabinet (server/doe/mail.ts) : aucune session humaine, donc aucun compte
//     mail personnel. Les destinataires sont ceux de la diffusion manuelle (server/reserveDiffusionContext.ts).
// Chaque passage est consigné dans le journal des exports (`reserve_exports`, canal « relance »).
import { randomUUID } from 'crypto';
import { loadSuspendedTenants } from './tenantSuspension';
import { envoyerMailCabinet, nomCabinet } from './doe/mail';
import { loadReserveContext, RESERVE_TITLE, type ReserveKind } from './reserveDiffusionContext';
import { buildReminderMail, estNonLevee, statutDiffusion, type ExportSend } from '../src/lib/reserveDiffusion';

const INTERVALLE_CYCLE_HEURES = 6;
const JOUR_MS = 24 * 60 * 60 * 1000;

export interface BilanRappels { reglages: number; envoyes: number; echecs: number }

/** Une opération : envoie un rappel à chaque entreprise concernée et consigne le passage. */
async function rappelerOperation(supabaseAdmin: any, reglage: any, maintenant: Date): Promise<{ envoyes: number; echecs: number }> {
  const kind = reglage.kind as ReserveKind;
  const tenantId = reglage.tenant_id as string;

  const { data: projet } = await supabaseAdmin.from('projects').select('archived_at').eq('id', reglage.project_id).eq('tenant_id', tenantId).maybeSingle();
  if (!projet || (projet as any).archived_at) return { envoyes: 0, echecs: 0 };

  const ctx = await loadReserveContext(supabaseAdmin, tenantId, reglage.project_id, kind, null);
  if (!ctx) return { envoyes: 0, echecs: 0 };
  const ouvertes = ctx.reserves.filter(estNonLevee);
  if (ouvertes.length === 0) return { envoyes: 0, echecs: 0 };

  const agence = await nomCabinet(supabaseAdmin, tenantId);
  const sends: ExportSend[] = [];
  for (const destinataire of ctx.recipients.entreprises) {
    const siennes = ctx.reserves.filter(r => destinataire.reserveIds.includes(r.id));
    const mail = buildReminderMail({
      recipientName: destinataire.name, title: RESERVE_TITLE[kind], projectName: ctx.project.name,
      projectCode: ctx.project.project_code, agencyName: agence, reserves: siennes as any[], today: maintenant,
    });
    if (!mail) continue; // cette entreprise n'a plus rien à lever
    const base = { key: destinataire.key, role: destinataire.role, name: destinataire.name, email: destinataire.email, reserve_count: siennes.filter(estNonLevee).length };
    if (!destinataire.email) {
      sends.push({ ...base, status: 'echec', sent_at: maintenant.toISOString(), error: "Pas d'adresse e-mail valable sur la fiche." });
      continue;
    }
    try {
      const res = await envoyerMailCabinet(supabaseAdmin, tenantId, { to: destinataire.email, subject: mail.subject, html: mail.html });
      sends.push(res.ok
        ? { ...base, status: 'envoye', sent_at: new Date().toISOString() }
        : { ...base, status: 'echec', sent_at: new Date().toISOString(), error: res.raison.slice(0, 300) });
    } catch (err: any) {
      sends.push({ ...base, status: 'echec', sent_at: new Date().toISOString(), error: String(err?.message || 'Envoi impossible').slice(0, 300) });
    }
  }
  if (sends.length === 0) return { envoyes: 0, echecs: 0 };

  const { error } = await supabaseAdmin.from('reserve_exports').insert({
    id: randomUUID(), tenant_id: tenantId, project_id: reglage.project_id, kind, scope: 'all', lots: [],
    reserve_count: ouvertes.length, channel: 'relance', status: statutDiffusion(sends), sends,
    note: 'Rappel hebdomadaire automatique', created_by: null, created_by_name: 'Rappel automatique',
  });
  if (error) console.error('[reserve-rappels] Journal non écrit :', error.message);
  return { envoyes: sends.filter(s => s.status === 'envoye').length, echecs: sends.filter(s => s.status === 'echec').length };
}

export async function executerRappelsReserves(supabaseAdmin: any, maintenant: Date = new Date()): Promise<BilanRappels> {
  const bilan: BilanRappels = { reglages: 0, envoyes: 0, echecs: 0 };
  const { data: reglages, error } = await supabaseAdmin.from('reserve_reminder_settings').select('*').eq('enabled', true);
  // Table absente (instance non migrée) : rien à faire, sans bruit.
  if (error || !reglages?.length) return bilan;

  const suspendus = await loadSuspendedTenants(supabaseAdmin);
  for (const reglage of reglages as any[]) {
    if (suspendus.has(reglage.tenant_id)) continue;
    const intervalle = Math.min(60, Math.max(1, Number(reglage.interval_days) || 7)) * JOUR_MS;
    const derniere = reglage.last_run_at ? new Date(reglage.last_run_at).getTime() : 0;
    if (derniere && derniere + intervalle > maintenant.getTime()) continue;

    // Prise de l'échéance : seule la mise à jour qui voit encore l'ancienne valeur réussit.
    let prise = supabaseAdmin.from('reserve_reminder_settings')
      .update({ last_run_at: maintenant.toISOString(), updated_at: maintenant.toISOString() })
      .eq('id', reglage.id).eq('enabled', true);
    prise = reglage.last_run_at ? prise.eq('last_run_at', reglage.last_run_at) : prise.is('last_run_at', null);
    const { data: prises } = await prise.select('id');
    if (!prises?.length) continue;

    bilan.reglages += 1;
    try {
      const r = await rappelerOperation(supabaseAdmin, reglage, maintenant);
      bilan.envoyes += r.envoyes;
      bilan.echecs += r.echecs;
    } catch (err: any) {
      console.error('[reserve-rappels] Opération en échec :', reglage.project_id, err?.message);
    }
  }
  return bilan;
}

/** Cycle périodique, même patron que server/doe/relances.ts. Inactif en mode hors ligne (pas de réseau garanti). */
export function startReserveReminders(supabaseAdmin: any): void {
  if (process.env.OFFLINE_MODE === 'true') return;
  const heures = parseInt(process.env.RESERVE_REMINDERS_INTERVAL_HOURS || '', 10) || INTERVALLE_CYCLE_HEURES;
  const cycle = () => executerRappelsReserves(supabaseAdmin).catch(e => console.error('[reserve-rappels] Cycle en échec :', e?.message));
  // Premier passage différé : le serveur doit être à l'écoute avant d'envoyer quoi que ce soit.
  setTimeout(cycle, 90_000).unref?.();
  setInterval(cycle, heures * 60 * 60 * 1000).unref?.();
}
