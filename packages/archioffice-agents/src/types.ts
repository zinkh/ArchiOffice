// ── Shared types for @zinkh/archioffice-agents ───────────────────────────────

export type AgentContextScope = 'meetings' | 'contacts' | 'projects' | 'documents' | 'tasks';

// Write permissions — separate from context_scopes (read-only) so an agent
// can be given data access without automatically being able to write.
export type AgentActionScope = 'contacts_write' | 'proposals_write';

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
