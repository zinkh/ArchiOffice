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
}
