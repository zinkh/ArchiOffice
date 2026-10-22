// Point d'entrée MCP (StreamableHTTP) que Gemini Spark appelle une fois la
// liaison OAuth établie (oauthRoutes.ts) — hors du préfixe /api, donc hors du
// middleware d'authentification Supabase JWT : l'authentification ici se
// fait par le jeton d'accès MCP (store.ts), un fournisseur d'identité
// différent pour une surface différente.
//
// Mode « stateless » du SDK (un couple Server/transport par requête) plutôt
// que des sessions MCP tenues en mémoire : ce process peut redémarrer ou
// tourner derrière plusieurs instances, et rien n'oblige Gemini à revenir
// sur la même instance d'une tâche de fond à l'autre.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolveAccessToken } from './store.js';
import { MCP_TOOLS } from './tools.js';
import { executeMcpToolForConnection } from './dispatch.js';

// Instructions servies à l'initialisation de la session MCP : elles complètent
// la description de chaque outil pour que l'assistant reste dans la bonne agence.
export const MCP_INSTRUCTIONS = [
  "ArchiOffice : gestion d'agence d'architecture. L'utilisateur peut appartenir à plusieurs agences (AAZS, AACZ...) ; chaque connexion travaille sur UNE agence à la fois.",
  "Avant une écriture ou si l'agence n'est pas certaine, vérifie-la avec get_active_agency. Chaque réponse porte l'agence utilisée (agency.id, agency.name, aussi dans _meta.agency).",
  "Pour changer d'agence (« travaille sur AACZ ») : switch_agency avec query ; si plusieurs agences correspondent (needs_clarification), demande laquelle à l'utilisateur au lieu de choisir. Annonce le changement uniquement après switched: true.",
  "Les identifiants (affaires, contacts, factures, documents, curseurs de pagination) ne sont valables que dans l'agence où ils ont été obtenus : après un changement d'agence, ne les réutilise jamais, relis les listes.",
  "Pour confirmer une action (confirm: true), repasse agency_id = l'agence de la demande de confirmation.",
  "Erreurs d'agence à distinguer : AGENCY_UNKNOWN (aucune agence accessible ne correspond), AGENCY_ACCESS_DENIED (l'agence existe mais l'accès est refusé ou révoqué), AGENCY_NOT_SELECTED (aucune agence sélectionnée : list_agencies puis switch_agency).",
].join('\n');

export function registerMcpEndpoint(app: any, supabaseAdmin: any, baseUrl: string): void {
  app.post('/mcp', async (req: any, res: any) => {
    // Chaque réponse dépend du jeton présenté et de l'outil appelé — jamais
    // la même deux fois, jamais à mettre en cache par un CDN devant l'app.
    res.set('Cache-Control', 'no-store');
    const authHeader = req.headers.authorization as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const resolved = token ? await resolveAccessToken(supabaseAdmin, token) : null;
    if (!resolved) {
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${baseUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource"`);
      return res.status(401).json({ error: 'unauthorized' });
    }

    const server = new Server({ name: 'archioffice', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.parametersJsonSchema })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      // Résolution refaite pour CET appel : l'appartenance est revérifiée (une
      // révocation prend effet tout de suite) et l'agence est figée pour toute
      // son exécution, quel que soit ce qui arrive aux autres appels en cours.
      const current = await resolveAccessToken(supabaseAdmin, token!);
      if (!current) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Session MCP expirée ou révoquée : reconnecte le connecteur.', code: 'UNAUTHORIZED' }) }], isError: true };
      return executeMcpToolForConnection({
        supabaseAdmin, baseUrl, authorization: `Bearer ${token}`, resolved: current,
        name: request.params.name, args: (request.params.arguments || {}) as Record<string, any>,
      });
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Le SDK MCP côté client sonde parfois GET/DELETE sur l'endpoint (gestion
  // de session). En mode stateless, il n'y a rien à y servir — mais 405
  // plutôt que 404, pour que le client distingue « pas de session » de
  // « endpoint inexistant ».
  app.get('/mcp', (_req: any, res: any) => res.status(405).json({ error: 'method_not_allowed' }));
  app.delete('/mcp', (_req: any, res: any) => res.status(405).json({ error: 'method_not_allowed' }));
}
