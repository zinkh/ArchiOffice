// Émission d'une demande de DOE à une entreprise (lien personnel + message) et
// relances automatiques.
//
// Le jeton clair n'existe que dans le lien envoyé : la base n'en garde que le
// haché. Émettre une demande à une entreprise qui en a déjà une crée donc un
// NOUVEAU lien et révoque l'ancien (comme « renvoyer le lien » du dépôt des
// offres). Quatre modes :
//   - 'sollicitation' : première demande, envoyée par e-mail ;
//   - 'relance'       : rappel (manuel ou automatique), compté ;
//   - 'visa'          : lien joint à un visa défavorable, sans compter une relance ;
//   - 'lien'          : lien à copier à la main, rien n'est envoyé ni compté.
//
// La relance automatique est un cycle périodique : pour chaque demande envoyée
// et encore active, elle relit le dossier (le statut se DÉDUIT des documents,
// voir dossier.ts) et relance si l'échéance est atteinte et que l'entreprise a
// encore quelque chose à remettre. La demande est « prise » par une mise à jour
// conditionnelle (revoked_at IS NULL) : deux processus ne l'envoient pas deux fois.
import crypto from 'crypto';
import { isValidEmail } from '../../src/lib/crDiffusion';
import {
  RELANCE_MAX_BORNE, avisDocument, construireRelance, construireSollicitation, expirationLienDoe, relanceDue,
  type DoeStatut,
} from '../../src/lib/doeAtelier';
import { loadSuspendedTenants } from '../tenantSuspension';
import { chargerDossier, libelleLot, piecesConcernees, tableAbsente, type DossierDoe, type EntrepriseDossier } from './dossier';
import { envoyerMailCabinet, nomCabinet } from './mail';
import { genererJetonDoe, hacherJetonDoe, lienDoe } from './tokens';

export type ModeDemande = 'sollicitation' | 'relance' | 'visa' | 'lien';

export interface ResultatDemande {
  ok: boolean;
  /** Lien personnel, rendu une seule fois (le jeton n'est pas conservé). */
  url?: string;
  envoye: boolean;
  /** Pourquoi rien n'est parti ou n'a pu être créé. */
  raison?: string;
  status?: number;
  demande?: any;
}

/** Observations du maître d'œuvre à reprendre dans un message : documents refusés ou commentés. */
function observationsAEnvoyer(e: EntrepriseDossier): string[] {
  return e.documents
    .filter(d => ['rejected', 'commented'].includes(avisDocument(d.validation_status)) && d.validation_comments)
    .map(d => `${d.name} : ${d.validation_comments}`);
}

const MIGRATION_ABSENTE = "L'atelier DOE n'est pas disponible sur cette instance (migration non jouée).";

export async function emettreDemande(
  supabaseAdmin: any,
  p: {
    tenantId: string;
    projectId: string;
    projet: { name?: string | null };
    dossier: DossierDoe;
    entreprise: EntrepriseDossier;
    mode: ModeDemande;
    /** Adresse choisie par l'utilisateur ; à défaut celle de la fiche. */
    email?: string | null;
    userId?: string | null;
  },
): Promise<ResultatDemande> {
  const { tenantId, projectId, dossier, entreprise, mode } = p;
  const email = isValidEmail(p.email) ? String(p.email).trim() : entreprise.email;
  if (mode !== 'lien' && !isValidEmail(email)) {
    return { ok: false, envoye: false, status: 400, raison: `Aucune adresse e-mail pour ${entreprise.nom} : renseignez-la sur sa fiche contact ou dans la demande.` };
  }

  const ancienne = entreprise.request;
  const maintenant = new Date();
  const jeton = genererJetonDoe();

  // La demande active en cours est révoquée D'ABORD (un seul lien actif par
  // entreprise, index unique partiel) ; « prise » conditionnelle contre un second envoi.
  if (ancienne) {
    const { data: prise, error: errPrise } = await supabaseAdmin.from('doe_requests')
      .update({ revoked_at: maintenant.toISOString() }).eq('id', ancienne.id).eq('tenant_id', tenantId).is('revoked_at', null).select('id');
    if (errPrise) {
      return { ok: false, envoye: false, status: tableAbsente(errPrise) ? 503 : 500, raison: tableAbsente(errPrise) ? MIGRATION_ABSENTE : "La demande n'a pas pu être créée." };
    }
    if (!prise?.length) return { ok: false, envoye: false, status: 409, raison: "Cette demande vient d'être traitée par un autre envoi." };
  }

  const compteur = ancienne?.reminder_count ?? 0;
  const nouvelle = {
    id: crypto.randomUUID(), tenant_id: tenantId, project_id: projectId,
    entreprise_key: entreprise.key, entreprise_nom: entreprise.nom, contact_id: entreprise.contact_id,
    email: isValidEmail(email) ? email : (ancienne?.email ?? null),
    lots_ids: entreprise.lots.map(l => l.id),
    token_hash: hacherJetonDoe(jeton),
    expires_at: expirationLienDoe(dossier.reglages.deadline_at, maintenant).toISOString(),
    sent_at: mode === 'sollicitation' ? maintenant.toISOString()
      : mode === 'lien' ? (ancienne?.sent_at ?? null)
      : (ancienne?.sent_at ?? maintenant.toISOString()),
    last_reminder_at: mode === 'relance' ? maintenant.toISOString() : (mode === 'sollicitation' ? null : ancienne?.last_reminder_at ?? null),
    reminder_count: mode === 'relance' ? compteur + 1 : (mode === 'sollicitation' ? 0 : compteur),
    created_by: p.userId || ancienne?.created_by || null,
  };

  const annuler = async () => {
    await supabaseAdmin.from('doe_requests').delete().eq('id', nouvelle.id).eq('tenant_id', tenantId);
    if (ancienne) await supabaseAdmin.from('doe_requests').update({ revoked_at: null }).eq('id', ancienne.id).eq('tenant_id', tenantId);
  };

  const { error } = await supabaseAdmin.from('doe_requests').insert(nouvelle);
  if (error) {
    if (ancienne) await supabaseAdmin.from('doe_requests').update({ revoked_at: null }).eq('id', ancienne.id).eq('tenant_id', tenantId);
    return { ok: false, envoye: false, status: tableAbsente(error) ? 503 : 500, raison: tableAbsente(error) ? MIGRATION_ABSENTE : "La demande n'a pas pu être créée." };
  }

  const url = lienDoe(jeton);
  if (mode === 'lien' || mode === 'visa') return { ok: true, url, envoye: false, demande: nouvelle };

  const cabinet = await nomCabinet(supabaseAdmin, tenantId);
  const params = {
    cabinet, operation: p.projet.name || 'Opération', entreprise: entreprise.nom, lien: url,
    lots: entreprise.lots.map(libelleLot),
    piecesAttendues: piecesConcernees({ documents: [] }, dossier.requises),
    piecesManquantes: entreprise.couverture.manquantes,
    deadlineAt: dossier.reglages.deadline_at, instructions: dossier.reglages.instructions,
    observations: observationsAEnvoyer(entreprise),
    numeroRelance: nouvelle.reminder_count,
  };
  const message = mode === 'relance' ? construireRelance(params) : construireSollicitation(params);
  const envoi = await envoyerMailCabinet(supabaseAdmin, tenantId, { to: String(email), ...message });
  if (!envoi.ok) {
    // Rien n'est parti : on rend l'ancien lien valable et on oublie le nouveau.
    await annuler();
    return { ok: false, envoye: false, status: 502, raison: envoi.raison };
  }
  return { ok: true, url, envoye: true, demande: nouvelle };
}

// ── Relances automatiques ────────────────────────────────────────────────────

const MAX_RELANCES_PAR_CYCLE = 100;

export interface BilanRelances {
  envoyees: number;
  echecs: number;
}

export async function executerRelances(supabaseAdmin: any, now: Date = new Date()): Promise<BilanRelances> {
  const bilan: BilanRelances = { envoyees: 0, echecs: 0 };
  const { data, error } = await supabaseAdmin.from('doe_requests')
    .select('id, tenant_id, project_id, sent_at, expires_at, reminder_count')
    .is('revoked_at', null).limit(2000);
  if (error) {
    if (!tableAbsente(error)) console.error('[doe-relances] Lecture des demandes impossible :', error.message);
    return bilan;
  }
  const actives = ((data as any[]) || []).filter(r =>
    r.sent_at && new Date(r.expires_at).getTime() > now.getTime() && (r.reminder_count ?? 0) < RELANCE_MAX_BORNE);
  if (!actives.length) return bilan;

  const suspendus = await loadSuspendedTenants(supabaseAdmin);
  const groupes = new Map<string, { tenantId: string; projectId: string }>();
  for (const r of actives) {
    if (suspendus.has(r.tenant_id)) continue;
    groupes.set(`${r.tenant_id}:${r.project_id}`, { tenantId: r.tenant_id, projectId: r.project_id });
  }

  for (const { tenantId, projectId } of groupes.values()) {
    if (bilan.envoyees + bilan.echecs >= MAX_RELANCES_PAR_CYCLE) break;
    try {
      const dossier = await chargerDossier(supabaseAdmin, tenantId, projectId);
      if (!dossier.disponible) continue;
      const { data: projet } = await supabaseAdmin.from('projects').select('id, name')
        .eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
      if (!projet) continue;
      for (const entreprise of dossier.entreprises) {
        if (!entreprise.request) continue;
        const statut: DoeStatut = entreprise.statut;
        const demande = { ...entreprise.request, email: entreprise.request.email || entreprise.email };
        if (!relanceDue(demande, dossier.reglages, statut, now)) continue;
        const r = await emettreDemande(supabaseAdmin, {
          tenantId, projectId, projet: projet as any, dossier, entreprise, mode: 'relance', email: demande.email,
        });
        if (r.ok) bilan.envoyees += 1; else bilan.echecs += 1;
        if (bilan.envoyees + bilan.echecs >= MAX_RELANCES_PAR_CYCLE) break;
      }
    } catch (e: any) {
      console.error(`[doe-relances] Opération ${projectId} ignorée :`, e?.message);
      bilan.echecs += 1;
    }
  }
  if (bilan.envoyees || bilan.echecs) console.log(`[doe-relances] ${bilan.envoyees} relance(s) envoyée(s), ${bilan.echecs} échec(s).`);
  return bilan;
}

const INTERVALLE_PAR_DEFAUT_HEURES = 6;

/** Cycle périodique, même patron que server/dunning.ts. Inactif en mode hors ligne (pas de réseau garanti). */
export function startDoeReminders(supabaseAdmin: any): void {
  if (process.env.OFFLINE_MODE === 'true') return;
  const heures = parseInt(process.env.DOE_REMINDERS_INTERVAL_HOURS || '', 10) || INTERVALLE_PAR_DEFAUT_HEURES;
  const cycle = () => executerRelances(supabaseAdmin).catch(e => console.error('[doe-relances] Cycle en échec :', e?.message));
  // Premier passage différé : le serveur doit être à l'écoute avant d'envoyer quoi que ce soit.
  setTimeout(cycle, 60_000).unref?.();
  setInterval(cycle, heures * 60 * 60 * 1000).unref?.();
}
