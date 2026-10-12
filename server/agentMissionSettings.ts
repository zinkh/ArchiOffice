// Préférences des missions persistantes, conservées par cabinet.
export interface AgentMissionSettings {
  enabled: boolean;
  capture_mail: boolean;
  capture_mail_review: boolean;
}

export async function getAgentMissionSettings(db: any, tenantId: string): Promise<AgentMissionSettings> {
  const { data, error } = await db.from('tenants')
    .select('agent_missions_enabled,agent_missions_capture_mail,agent_missions_capture_mail_review')
    .eq('id', tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Cabinet introuvable.');
  // Fail closed if an old schema/malformed fake lacks the preference columns.
  return {
    enabled: data.agent_missions_enabled === true,
    capture_mail: data.agent_missions_capture_mail === true,
    capture_mail_review: data.agent_missions_capture_mail_review === true,
  };
}

export async function isAgentMissionEnabled(db: any, tenantId: string): Promise<boolean> {
  return (await getAgentMissionSettings(db, tenantId)).enabled;
}

/** Vérification légère avant lancement du worker, tolérante aux déploiements sans migration. */
export async function isAgentMissionSchemaReady(db: any): Promise<boolean> {
  const [missions, events, prefs] = await Promise.all([
    db.from('agent_missions').select('id').limit(1),
    db.from('agent_mission_events').select('id').limit(1),
    db.from('tenants').select('agent_missions_enabled,agent_missions_capture_mail,agent_missions_capture_mail_review').limit(1),
  ]);
  return !missions.error && !events.error && !prefs.error;
}
