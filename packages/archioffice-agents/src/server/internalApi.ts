// Les outils d'agent exécutent leurs actions en rappelant l'API de
// l'application en boucle locale, avec le jeton de la personne qui parle à
// l'agent : « une action se comporte exactement comme si l'utilisateur
// l'avait faite lui-même » (voir tools.ts).
//
// Depuis qu'un architecte peut exercer dans plusieurs cabinets, le jeton ne
// suffit plus à désigner le cabinet : c'est l'en-tête X-Tenant-Id qui le fait
// (server/tenantContext.ts). Il doit donc être repris tel quel sur l'appel
// interne — sans lui, un agent sollicité depuis le second cabinet écrirait
// dans le premier, celui du profil par défaut.
export interface InternalAuth {
  /** L'en-tête Authorization de la requête d'origine. */
  authorization: string;
  /** Le cabinet sur lequel la conversation en cours travaille. */
  tenantId?: string | null;
}

export function internalHeaders(auth: InternalAuth, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}), Authorization: auth.authorization };
  if (auth.tenantId) headers['X-Tenant-Id'] = auth.tenantId;
  return headers;
}
