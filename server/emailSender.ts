// Expéditeur d'un e-mail envoyé par le SMTP du cabinet (POST /api/send-email,
// diffusion d'un compte-rendu). Deux adresses possibles :
//
//   - l'adresse GÉNÉRALE de l'agence (`settings.email`), commune à tout le cabinet ;
//   - l'adresse PERSONNELLE de la personne DANS ce cabinet
//     (`tenant_memberships.sender_email`) : un même compte exerce dans plusieurs
//     agences et n'y écrit pas avec la même adresse, ni avec celle de sa connexion.
//
// Le choix entre les deux est celui de la personne (`profiles.sender_option`),
// à défaut celui du cabinet (`settings.sender_option`). L'adresse n'est JAMAIS
// lue dans la requête d'un client : n'importe quelle personne connectée aurait
// pu écrire « de la part » de n'importe qui.
//
// Sans adresse personnelle enregistrée (ou sur une instance qui n'a pas joué
// migrate_membership_sender_email.sql), les messages partent de l'adresse de
// l'agence plutôt que sans expéditeur.
import { isValidEmail } from '../src/lib/crDiffusion';

export interface ResolvedSender {
  mode: 'agency' | 'personal';
  from?: string;
  /** L'agence est mise en copie d'un message envoyé depuis une adresse personnelle. */
  cc?: string;
  replyTo?: string;
}

/** Adresse d'envoi personnelle de la personne dans ce cabinet, '' s'il n'y en a pas ou si la base ne l'a pas. */
export async function readMembershipSenderEmail(supabaseAdmin: any, userId: string, tenantId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('tenant_memberships')
    .select('sender_email')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  // Colonne absente (instance non migrée) : pas d'adresse personnelle, pas d'échec.
  if (error) return '';
  const value = (data as any)?.sender_email;
  return isValidEmail(value) ? value.trim() : '';
}

export async function resolveEmailSender(
  supabaseAdmin: any,
  { tenantId, userId, settings }: { tenantId: string; userId: string; settings: any },
): Promise<ResolvedSender> {
  const { data: profile } = await supabaseAdmin.from('profiles').select('sender_option').eq('id', userId).maybeSingle();
  const own = (profile as any)?.sender_option;
  const preference: 'agency' | 'personal' =
    own === 'agency' || own === 'personal' ? own : settings?.sender_option === 'personal' ? 'personal' : 'agency';

  const agency = isValidEmail(settings?.email) ? String(settings.email).trim() : undefined;

  if (preference === 'personal') {
    const personal = await readMembershipSenderEmail(supabaseAdmin, userId, tenantId);
    if (personal) {
      return {
        mode: 'personal',
        from: personal,
        cc: agency && agency.toLowerCase() !== personal.toLowerCase() ? agency : undefined,
        replyTo: personal,
      };
    }
  }
  return { mode: 'agency', from: agency };
}
