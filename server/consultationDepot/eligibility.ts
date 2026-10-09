// Qui peut ouvrir un espace de dépôt, et dans quelles conditions.
//
// Trois exigences, vérifiées à CHAQUE usage (création d'un lien côté cabinet, et
// à chaque appel du portail public) et non une fois pour toutes :
//   1. plan Enterprise ;
//   2. marché privé : en marché public, la remise dématérialisée passe
//      légalement par un profil acheteur, que ce portail ne remplace pas ;
//   3. un espace de stockage externe actif (Google Drive, Dropbox, Nextcloud,
//      kDrive) : les offres ne sont JAMAIS stockées dans Supabase.
// Perdre l'une d'elles ferme les liens déjà émis, sans les supprimer.
import { getActiveConnection, type ExternalStorageConnection } from '../externalStorage/externalConnection';

export type CodeEligibilite =
  | 'plan_requis'
  | 'marche_public'
  | 'stockage_requis'
  | 'stockage_a_reconnecter'
  | 'hors_ligne'
  | 'projet_introuvable';

export const MESSAGES_ELIGIBILITE: Record<CodeEligibilite, string> = {
  plan_requis: "L'espace de dépôt des offres est réservé au plan Enterprise.",
  marche_public:
    "L'espace de dépôt est réservé aux marchés privés. Pour un marché public, la remise des offres passe par le profil acheteur.",
  stockage_requis:
    "Connectez d'abord l'espace de stockage du cabinet (Google Drive, Dropbox, Nextcloud ou kDrive) dans Réglages : les offres y sont déposées, jamais chez ArchiOffice.",
  stockage_a_reconnecter:
    "La connexion à l'espace de stockage du cabinet doit être renouvelée dans Réglages avant de recevoir des offres.",
  hors_ligne: "L'espace de dépôt n'est pas disponible en mode hors ligne.",
  projet_introuvable: 'Opération introuvable pour ce cabinet.',
};

export interface ProjetDepot {
  id: string;
  name: string | null;
  project_code: string | null;
  is_public_client: boolean | null;
}

export type Eligibilite =
  | { eligible: true; connection: ExternalStorageConnection; project: ProjetDepot }
  | { eligible: false; code: CodeEligibilite; message: string };

const refus = (code: CodeEligibilite): Eligibilite => ({ eligible: false, code, message: MESSAGES_ELIGIBILITE[code] });

export interface DepsEligibilite {
  supabaseAdmin: any;
  getTenantPlan: (tenantId: string) => Promise<{ plan: string }>;
}

export async function evaluerEligibilite(
  { supabaseAdmin, getTenantPlan }: DepsEligibilite,
  tenantId: string,
  projectId: string,
): Promise<Eligibilite> {
  const { plan } = await getTenantPlan(tenantId);
  if (plan !== 'enterprise') return refus('plan_requis');

  if (process.env.OFFLINE_MODE === 'true') return refus('hors_ligne');

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id, name, project_code, is_public_client')
    .eq('id', projectId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!project) return refus('projet_introuvable');
  if ((project as ProjetDepot).is_public_client) return refus('marche_public');

  const connection = await getActiveConnection(supabaseAdmin, tenantId);
  if (!connection) return refus('stockage_requis');
  if (connection.status === 'needs_reauth') return refus('stockage_a_reconnecter');

  return { eligible: true, connection, project: project as ProjetDepot };
}
