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
import { MCP_TOOLS, executeMcpTool } from './tools.js';
import type { InternalAuth } from '../internalApi.js';

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

    const auth: InternalAuth = { authorization: `Bearer ${token}`, tenantId: resolved.tenantId };

    const server = new Server({ name: 'archioffice', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.parametersJsonSchema })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return executeMcpTool(baseUrl, auth, request.params.name, (request.params.arguments || {}) as Record<string, any>);
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
