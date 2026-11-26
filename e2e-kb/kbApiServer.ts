// API de test de la « Base de données » du cabinet : le VRAI code serveur (server/routes/knowledgeBase.ts)
// sur la fausse base en mémoire des tests (tests/fakeSupabaseAdmin.ts). Aucune clé, aucun compte, aucune
// donnée réelle. Lancé par playwright.kb.config.ts ; le serveur Vite de e2e-kb/vite.config.ts lui renvoie /api.
// `POST /__reset` repart d'une base vide (un test = une base propre). Le dépôt de fichiers et l'URL signée
// sont simulés : pas de stockage ici.
import express from 'express';
import { FakeSupabaseAdmin } from '../tests/fakeSupabaseAdmin';
import { registerKnowledgeBaseRoutes } from '../server/routes/knowledgeBase';

const port = Number(process.env.KB_API_PORT ?? 4311);

let db = new FakeSupabaseAdmin();
const supabaseAdmin = { from: (table: string) => db.from(table) };

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use((req: any, _res, next) => { req.user = { id: 'e2e-user' }; next(); });

app.get('/__health', (_req, res) => { res.json({ ok: true }); });
app.post('/__reset', (_req, res) => { db = new FakeSupabaseAdmin(); res.json({ ok: true }); });

registerKnowledgeBaseRoutes(app as any, {
  supabaseAdmin,
  getTenantId: async () => 'e2e-tenant',
  requireRole: () => async (_req: any, _res: any, next: any) => next(),
});

// Dépôt d'un fichier : le corps multipart est lu puis jeté, la réponse porte une adresse de stockage fictive.
app.post('/api/documents', (req, res) => {
  req.resume();
  req.on('end', () => { res.status(201).json({ id: crypto.randomUUID(), file_url: `fake-storage/${crypto.randomUUID()}.png`, size_bytes: 1 }); });
});

// URL signée : une image PNG de 1 pixel, pour que l'éditeur affiche l'image déposée.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
app.get('/api/storage/signed-url', (_req, res) => { res.json({ url: PIXEL, expiresIn: 3600 }); });

app.listen(port, '127.0.0.1', () => { console.log(`[kb-api] http://127.0.0.1:${port}`); });
