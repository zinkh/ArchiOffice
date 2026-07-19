// ── Gemini function-calling tools — gated per agent by action_scopes ────────
// Read-only context (buildAgentContext) stays separate from these: an agent
// can be given data visibility (context_scopes) without being able to write,
// and a write action is only exposed when the tenant explicitly enabled it
// for that agent (agents.action_scopes, set from AgentConfig).

export interface FunctionDeclarationLike {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export function buildAgentTools(actionScopes: string[]): FunctionDeclarationLike[] {
  const tools: FunctionDeclarationLike[] = [];

  if (actionScopes.includes('contacts_write')) {
    tools.push({
      name: 'create_contact',
      description:
        "Crée une nouvelle fiche contact (client particulier, entreprise ou intervenant) dans le cabinet. " +
        "À utiliser quand l'utilisateur demande d'ajouter ou d'enregistrer un nouveau contact/client qui n'existe pas encore dans la liste de contacts fournie en contexte.",
      parametersJsonSchema: {
        type: 'object',
        properties: {
          first_name: { type: 'string', description: 'Prénom du contact' },
          last_name: { type: 'string', description: 'Nom de famille du contact' },
          company_name: { type: 'string', description: "Raison sociale de l'entreprise, si le contact en représente une" },
          email: { type: 'string', description: 'Adresse email' },
          phone: { type: 'string', description: 'Numéro de téléphone' },
          category: { type: 'string', description: 'Catégorie du contact, par ex. Client, Entreprise, Partenaire' },
          address: { type: 'string', description: 'Adresse postale' },
          city: { type: 'string', description: 'Ville' },
          zip: { type: 'string', description: 'Code postal' },
          notes: { type: 'string', description: 'Notes libres sur le contact' },
        },
        required: ['first_name', 'last_name'],
      },
    });
  }

  if (actionScopes.includes('proposals_write')) {
    tools.push({
      name: 'create_proposal',
      description:
        "Crée un nouveau devis (proposition commerciale) pour un client. " +
        "Utilise le client_id d'un contact existant, trouvé dans la liste de contacts fournie en contexte ou renvoyé par un appel create_contact précédent dans cette même conversation. " +
        "Si le client n'existe pas encore, crée-le d'abord avec create_contact.",
      parametersJsonSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Objet / intitulé de la mission, par ex. "Extension maison individuelle à Lyon"' },
          client_id: { type: 'string', description: "Identifiant du contact client" },
          amount: { type: 'number', description: 'Montant HT estimé des honoraires, si connu' },
          description: { type: 'string', description: 'Description du projet ou de la mission' },
        },
        required: ['title', 'client_id'],
      },
    });
  }

  return tools;
}

export interface AgentActionHelpers {
  logActivity: (
    tenantId: string, userId: string, userName: string,
    action: string, target: string, targetId: string, targetType: string, category: string
  ) => Promise<void>;
  getNextDocNumber: (tenantId: string, settingCol: string, countTable: string, defaultPrefix: string) => Promise<string>;
}

export interface AgentActionCall {
  name?: string;
  args?: Record<string, unknown>;
}

export interface AgentActionResult {
  response: Record<string, unknown>;
  summary?: string;
}

export async function executeAgentAction(
  supabaseAdmin: any,
  tenantId: string,
  userId: string,
  userName: string,
  actionScopes: string[],
  helpers: AgentActionHelpers,
  call: AgentActionCall
): Promise<AgentActionResult> {
  const name = call.name;
  const args = call.args || {};
  const str = (v: unknown): string | null => (v === undefined || v === null || v === '') ? null : String(v);

  try {
    if (name === 'create_contact') {
      if (!actionScopes.includes('contacts_write')) {
        return { response: { error: "Cette action n'est pas autorisée pour cet agent." } };
      }
      const first_name = String(args.first_name || '').trim();
      const last_name = String(args.last_name || '').trim();
      if (!first_name || !last_name) {
        return { response: { error: 'first_name et last_name sont requis.' } };
      }

      const id = crypto.randomUUID();
      const contact = {
        id, tenant_id: tenantId,
        first_name, last_name,
        company_name: str(args.company_name),
        email: str(args.email),
        phone: str(args.phone),
        category: str(args.category),
        address: str(args.address),
        city: str(args.city),
        zip: str(args.zip),
        notes: str(args.notes),
        created_at: new Date().toISOString(),
      };
      const { error } = await supabaseAdmin.from('contacts').insert(contact);
      if (error) return { response: { error: error.message } };

      const contactName = contact.company_name || `${first_name} ${last_name}`.trim();
      await helpers.logActivity(tenantId, userId, userName, `Création du contact "${contactName}" par l'agent IA`, contactName, id, 'contact', 'Contacts');

      return {
        response: { success: true, id, name: contactName },
        summary: `Contact créé : ${contactName}`,
      };
    }

    if (name === 'create_proposal') {
      if (!actionScopes.includes('proposals_write')) {
        return { response: { error: "Cette action n'est pas autorisée pour cet agent." } };
      }
      const title = String(args.title || '').trim();
      const client_id = str(args.client_id);
      if (!title || !client_id) {
        return { response: { error: "title et client_id sont requis. Crée d'abord le contact avec create_contact si nécessaire." } };
      }

      const { data: client } = await supabaseAdmin.from('contacts').select('id').eq('id', client_id).eq('tenant_id', tenantId).maybeSingle();
      if (!client) return { response: { error: 'client_id introuvable pour ce cabinet.' } };

      const id = crypto.randomUUID();
      const reference = await helpers.getNextDocNumber(tenantId, 'num_prefix_devis', 'proposals', 'DEVIS');
      const amount = typeof args.amount === 'number' ? args.amount : Number(args.amount) || 0;
      const proposal = {
        id, tenant_id: tenantId,
        title, client_id, amount,
        status: 'Draft',
        description: str(args.description),
        reference,
        created_at: new Date().toISOString(),
      };
      const { error } = await supabaseAdmin.from('proposals').insert(proposal);
      if (error) return { response: { error: error.message } };

      await helpers.logActivity(tenantId, userId, userName, `Création du devis "${reference}" par l'agent IA`, title, id, 'proposal', 'Devis');

      return {
        response: { success: true, id, reference },
        summary: `Devis créé : ${reference} — ${title}`,
      };
    }

    return { response: { error: `Fonction inconnue : ${name}` } };
  } catch (e: any) {
    return { response: { error: e?.message || 'Erreur inconnue lors de l\'exécution de l\'action.' } };
  }
}
