// ── Shared types for @zinkh/archioffice-agents ───────────────────────────────

export type AgentContextScope = 'meetings' | 'contacts' | 'projects' | 'documents' | 'tasks';

// Write permissions — separate from context_scopes (read-only) so an agent
// can be given data access without automatically being able to write.
// One scope = one resource = the same create/update/delete surface a human
// has in that section of the app, exposed to the agent via the app's own
// REST API (see server/tools.ts) so behavior always matches the UI exactly.
export type AgentActionScope = string;

export interface AgentResourceDef {
  key: string;
  label: string;
  basePath: string;
  create: boolean;
  update: boolean;
  delete: boolean;
  /** Human-readable field hint injected into the agent's system prompt. */
  fields: string;
}

export const AGENT_RESOURCES: AgentResourceDef[] = [
  { key: 'contacts', label: 'Contacts', basePath: '/api/contacts', create: true, update: true, delete: true,
    fields: 'first_name*, last_name*, company_name, email, phone, category, address, city, zip, notes' },
  { key: 'proposals', label: 'Devis', basePath: '/api/proposals', create: true, update: true, delete: false,
    fields: 'title*, client_id*, amount, status (Draft/Sent/Accepted/Rejected), description' },
  { key: 'projects', label: 'Projets', basePath: '/api/projects', create: true, update: true, delete: true,
    fields: 'name*, client*, status*, client_id, budget, category, start_date, end_date, description, address' },
  { key: 'tenders', label: "Appels d'offres", basePath: '/api/tenders', create: true, update: true, delete: true,
    fields: 'title*, client*, submission_deadline*, status*, description, amount' },
  { key: 'invoices', label: 'Factures', basePath: '/api/invoices', create: true, update: true, delete: false,
    fields: 'status* (Draft/Sent/Paid/Overdue), title, project_id, client_id, amount, due_date' },
  { key: 'specifications', label: 'CCTP', basePath: '/api/specifications', create: true, update: true, delete: true,
    fields: 'title*, project_id, description, content' },
  { key: 'tasks', label: 'Tâches', basePath: '/api/tasks', create: true, update: true, delete: true,
    fields: 'title*, start_date*, end_date*, project_id, status, description' },
  { key: 'milestones', label: 'Jalons', basePath: '/api/milestones', create: true, update: true, delete: true,
    fields: 'title*, due_date*, project_id, status' },
  { key: 'meetings', label: 'Réunions', basePath: '/api/meetings', create: true, update: true, delete: true,
    fields: "title*, date*, type (projet/visite_candidature/visite_proposition), project_id, notes" },
  { key: 'contrats_moe', label: 'Contrats MOE', basePath: '/api/contrats_moe', create: true, update: true, delete: true,
    fields: 'client_id, project_id, type_contrat, type_moa, montant_honoraires, intitule_projet' },
  { key: 'ordres_de_service', label: 'Ordres de service', basePath: '/api/ordres_de_service', create: true, update: true, delete: true,
    fields: 'os_number*, title*, date*, project_id' },
  { key: 'visas', label: 'Visas', basePath: '/api/visas', create: true, update: true, delete: true,
    fields: 'title*, date*, project_id' },
  { key: 'receptions', label: 'Réceptions', basePath: '/api/receptions', create: true, update: true, delete: true,
    fields: 'date*, type*, project_id' },
  { key: 'reserves', label: 'Réserves', basePath: '/api/reserves', create: true, update: true, delete: true,
    fields: 'title*, project_id' },
  { key: 'marches_entreprises', label: 'Marchés entreprises', basePath: '/api/marches-entreprises', create: true, update: true, delete: true,
    fields: 'project_id*, entreprise_nom*, lot_numero, lot_titre, montant_ht' },
  { key: 'notes_honoraires', label: "Notes d'honoraires", basePath: '/api/notes_honoraires', create: true, update: true, delete: true,
    fields: 'project_id, contrat_id, numero, date, objet, montant_ht' },
];

export interface Agent {
  id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  role_title: string;
  avatar_initials: string;
  avatar_color: string;
  tone?: string;
  directives?: string;
  system_prompt_override?: string;
  context_scopes: AgentContextScope[];
  action_scopes: AgentActionScope[];
  is_active: boolean;
  is_system_template: boolean;
  created_at: string;
}

export interface AgentConversation {
  id: string;
  tenant_id: string;
  agent_id: string;
  user_id: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  tenant_id: string;
  role: 'user' | 'assistant';
  content: string;
  artifact?: AgentArtifact;
  created_at: string;
}

export interface AgentArtifact {
  type: 'excel' | 'docx' | 'csv';
  filename: string;
  data: string; // base64
  mimeType: string;
}

export interface AgentTokenUsage {
  id: string;
  tenant_id: string;
  agent_id: string;
  user_id: string;
  conversation_id: string;
  tokens_used: number;
  cost_eur_cents?: number;
  created_at: string;
}

export interface AgentChatResponse {
  reply: string;
  tokens_used: number;
  remaining_balance: number;
  artifact?: AgentArtifact;
}

// Internal server-side types
export interface AgentRow {
  id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  role_title: string;
  avatar_initials: string;
  avatar_color: string;
  tone?: string;
  directives?: string;
  system_prompt_override?: string;
  context_scopes: string[];
  action_scopes: string[];
  is_active: boolean;
  is_system_template: boolean;
}

export interface AgentContext {
  tenantName: string;
  currentDate: string;
  currentUserName: string;
  projects: { id: string; name: string; status: string; client: string; start_date: string; end_date: string }[];
  contacts: { id: string; first_name: string; last_name: string; company_name: string; email: string }[];
  upcomingMeetings: { id: string; title: string; date: string; project_id: string }[];
  recentDocuments: { id: string; name: string; project_id: string; phase: string; uploaded_at: string; file_url: string }[];
  tasks: { id: string; title: string; status: string; due_date: string; project_id: string }[];
  documentContents: { id: string; name: string; content: string }[];
}
