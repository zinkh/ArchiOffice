// ── Shared types for @zinkh/archioffice-agents ───────────────────────────────

export type AgentContextScope = 'meetings' | 'contacts' | 'projects' | 'documents' | 'tasks';

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
  created_at: string;
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
  recentDocuments: { id: string; name: string; project_id: string; phase: string; uploaded_at: string }[];
  tasks: { id: string; title: string; status: string; due_date: string; project_id: string }[];
}
