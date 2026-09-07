// Forme d'une déclaration d'outil, volontairement neutre vis-à-vis des
// fournisseurs (voir llm/types.ts) : du JSON Schema brut, que les trois
// adaptateurs savent traduire sans réécriture.
export interface FunctionDeclarationLike {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface ToolOutcome {
  response: Record<string, unknown>;
  summary?: string;
  /** Posé par consulter_agent (delegateTools.ts) : le collègue effectivement
   *  consulté, pour que la route de chat le fasse remonter au client
   *  (AgentChatResponse.consulted) et lui ouvre sa conversation. */
  consulted?: { id: string; name: string };
}
