// Génération d'un CCTP à partir des pièces d'une affaire (plans du DCE,
// programme, notice descriptive...). Deux moteurs, au choix de l'architecte
// dans l'éditeur CCTP :
//
// - « llm » : le texte des pièces est lu par le moteur de lecture actif
//   (local ou Nomic Parse, réglé dans /admin — voir documentParser.ts), puis
//   le fournisseur IA de la plateforme (Gemini, Claude, Mistral) rédige la
//   structure lots > chapitres > articles. Facturé aux crédits IA du cabinet
//   selon le patron réserve → exécute → règle de tenderAi.ts.
// - « nomic » : les pièces sont déposées telles quelles chez Nomic et son
//   extraction structurée (/v1/extract) remplit directement le schéma du
//   CCTP — le modèle voit le plan lui-même, pas un texte déjà aplati.
//   Consommé sur le compte Nomic de l'opérateur : ce coût n'a pas de tarif au
//   jeton publié que MODEL_CATALOG pourrait porter, il n'est donc PAS
//   refacturé aux crédits du cabinet (pas de montant inventé).
//
// La route ne réécrit jamais le document : elle rend une proposition que
// l'éditeur ajoute à l'arbre du DPGF/CCTP, à relire puis enregistrer par
// l'architecte comme n'importe quelle saisie.
import type { Express } from 'express';
import * as Sentry from '@sentry/node';
import { aiGenerationLimiter } from '../rateLimit';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  reserveAiCredit: (tenantId: string, estimateCents: number) => Promise<boolean>;
  settleAiCredit: (params: {
    tenantId: string; userId: string; agentId: string | null; conversationId: string | null;
    endpointType: 'cctp_generation'; provider: string; model: string; reservedCents: number;
    inputTokens: number; outputTokens: number;
  }) => Promise<{ newBalance: number; costCents: number }>;
  refundAiCredit: (tenantId: string, cents: number) => Promise<void>;
  estimateReserveCents: (provider: string, model: string, inputTokens: number) => Promise<number>;
}

export type CctpGenerationEngine = 'llm' | 'nomic';

export interface GeneratedArticle { designation: string; unite: string; localisation: string; description: string }
export interface GeneratedChapitre { titre: string; description: string; articles: GeneratedArticle[] }
export interface GeneratedLot { titre: string; description: string; chapitres: GeneratedChapitre[] }

const MAX_DOCUMENTS = 10;
const MAX_SOURCE_CHARS = 60_000; // borne le coût d'un appel, comme MAX_DCE_CHARS
const MAX_INSTRUCTIONS_CHARS = 2_000;
const NOMIC_EXTRACT_TIMEOUT_MS = 170_000;
const MAX_LOTS = 40;
const MAX_CHAPITRES = 40;
const MAX_ARTICLES = 80;

const CCTP_SCHEMA = {
  type: 'object',
  properties: {
    lots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titre: { type: 'string', description: 'Intitulé du lot (corps d\'état), ex. « Gros œuvre », « Menuiseries extérieures »' },
          description: { type: 'string', description: 'Généralités du lot : normes (NF DTU), limites de prestation, prescriptions communes' },
          chapitres: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                titre: { type: 'string' },
                description: { type: 'string' },
                articles: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      designation: { type: 'string', description: 'Désignation courte de l\'ouvrage' },
                      unite: { type: 'string', description: 'Unité de mesure : m², m³, ml, U, ens, forfait' },
                      localisation: { type: 'string', description: 'Pièce, niveau ou ouvrage concerné, lu sur les plans' },
                      description: { type: 'string', description: 'Prescriptions techniques : matériaux, mise en œuvre, performances, normes' },
                    },
                    required: ['designation', 'description'],
                  },
                },
              },
              required: ['titre', 'articles'],
            },
          },
        },
        required: ['titre', 'chapitres'],
      },
    },
  },
  required: ['lots'],
};

const SYSTEM_PROMPT = `Tu es un économiste de la construction et rédacteur de CCTP pour un cabinet d'architecture français.
À partir des pièces fournies (plans, coupes, façades, notices, programme), rédige la structure d'un Cahier des Clauses Techniques Particulières :
- des lots par corps d'état, dans l'ordre usuel d'un marché de travaux (gros œuvre, charpente, couverture, menuiseries, plâtrerie, électricité, plomberie, CVC, revêtements, peinture, VRD...) ;
- dans chaque lot, des chapitres, puis des articles décrivant chaque ouvrage : matériaux, mise en œuvre, performances attendues et références normatives (NF DTU, Eurocodes, RE2020) ;
- la localisation d'un article quand les plans permettent de la lire (pièce, niveau, façade).
Ne retiens que les ouvrages que les pièces justifient réellement ; n'invente ni dimensions ni marques. Rédige en français.`;

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Retrouve le tableau `lots` où qu'il soit dans la réponse (Nomic peut
 *  l'envelopper), puis ramène chaque nœud à la forme attendue par l'éditeur,
 *  en écartant ce qui n'a pas d'intitulé. */
export function normalizeGeneratedCctp(raw: unknown): GeneratedLot[] {
  const findLots = (node: unknown, depth: number): unknown[] | null => {
    if (!node || typeof node !== 'object' || depth > 4) return null;
    if (Array.isArray((node as any).lots)) return (node as any).lots;
    for (const value of Object.values(node as Record<string, unknown>)) {
      const found = findLots(value, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const lots = findLots(raw, 0) ?? [];
  return lots.slice(0, MAX_LOTS).flatMap((lot: any): GeneratedLot[] => {
    const titre = str(lot?.titre, 200);
    if (!titre) return [];
    const chapitres = (Array.isArray(lot?.chapitres) ? lot.chapitres : []).slice(0, MAX_CHAPITRES).flatMap((chap: any): GeneratedChapitre[] => {
      const chapTitre = str(chap?.titre, 200);
      if (!chapTitre) return [];
      const articles = (Array.isArray(chap?.articles) ? chap.articles : []).slice(0, MAX_ARTICLES).flatMap((a: any): GeneratedArticle[] => {
        const designation = str(a?.designation, 300);
        if (!designation) return [];
        return [{ designation, unite: str(a?.unite, 20), localisation: str(a?.localisation, 200), description: str(a?.description, 8000) }];
      });
      return [{ titre: chapTitre, description: str(chap?.description, 8000), articles }];
    });
    return [{ titre, description: str(lot?.description, 8000), chapitres }];
  });
}

export function registerCctpGenerationRoutes(app: Express, deps: RouteDeps) {
  const { supabaseAdmin, getTenantId, reserveAiCredit, settleAiCredit, refundAiCredit, estimateReserveCents } = deps;

  // Ce que l'éditeur peut proposer : Nomic n'apparaît utilisable que si
  // l'instance porte sa clé. Le moteur de lecture actif est rendu à titre
  // d'information (« lu par Nomic Parse, rédigé par Gemini »).
  app.get('/api/cctp/generation-engines', async (_req: any, res: any) => {
    try {
      const { isNomicConfigured, describeDocumentParser } = await import('@zinkh/archioffice-agents/server');
      const { engine: parser } = await describeDocumentParser();
      res.json({
        parser: parser === 'nomic' && isNomicConfigured() ? 'nomic' : 'local',
        engines: [
          { engine: 'llm', available: true },
          { engine: 'nomic', available: isNomicConfigured() },
        ],
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/projects/:projectId/cctp/generate', aiGenerationLimiter, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const engine: CctpGenerationEngine = req.body?.engine === 'nomic' ? 'nomic' : 'llm';
      const instructions = str(req.body?.instructions, MAX_INSTRUCTIONS_CHARS);
      const documentIds: string[] = Array.isArray(req.body?.document_ids)
        ? req.body.document_ids.filter((id: unknown) => typeof id === 'string').slice(0, MAX_DOCUMENTS)
        : [];
      if (!documentIds.length) return res.status(400).json({ error: 'Sélectionnez au moins une pièce (plan, notice, programme).' });

      const { data: project } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('id, name, address').eq('id', projectId).maybeSingle();
      if (!project) return res.status(404).json({ error: 'Affaire introuvable.' });

      // Seules les pièces de CETTE affaire : un id d'un autre projet du
      // cabinet (ou d'un autre cabinet) est simplement écarté.
      const { data: docRows } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents').select('id, name, file_url, project_id').in('id', documentIds);
      const docs = ((docRows as any[]) || []).filter(d => d.project_id === projectId);
      if (!docs.length) return res.status(400).json({ error: 'Aucune des pièces sélectionnées n\'appartient à cette affaire.' });

      const agents = await import('@zinkh/archioffice-agents/server');
      const context = `Affaire : ${(project as any).name}${(project as any).address ? ` (${(project as any).address})` : ''}.${instructions ? `\nConsignes de l'architecte : ${instructions}` : ''}`;
      const ignored: string[] = [];

      if (engine === 'nomic') {
        if (!agents.isNomicConfigured()) return res.status(503).json({ error: 'Nomic n\'est pas configuré sur cette instance (NOMIC_API_KEY).' });
        const fileUrls: string[] = [];
        for (const doc of docs) {
          if (!agents.nomicContentType(doc.name || '')) { ignored.push(doc.name); continue; }
          const fetched = await agents.readStorageObject(supabaseAdmin, tenantId, doc.file_url);
          if (!fetched) { ignored.push(doc.name); continue; }
          fileUrls.push(await agents.nomicUploadFile(doc.name, fetched.buffer));
        }
        if (!fileUrls.length) return res.status(400).json({ error: 'Aucune pièce lisible par Nomic (PDF, Office ou image attendus).', ignored });
        const raw = await agents.nomicExtract(fileUrls, CCTP_SCHEMA, `${SYSTEM_PROMPT}\n\n${context}`, NOMIC_EXTRACT_TIMEOUT_MS);
        const lots = normalizeGeneratedCctp(raw);
        console.log(`[cctp generation] tenant ${tenantId} : ${fileUrls.length} pièce(s) extraites par Nomic, ${lots.length} lot(s)`);
        return res.json({ engine, lots, documents_read: fileUrls.length, ignored });
      }

      let combined = '';
      for (const doc of docs) {
        if (combined.length >= MAX_SOURCE_CHARS) break;
        const text = await agents.extractKnowledgeDocText(supabaseAdmin, tenantId, doc).catch(() => null);
        if (!text) { ignored.push(doc.name); continue; }
        combined += `\n\n--- ${doc.name} ---\n${text.slice(0, MAX_SOURCE_CHARS - combined.length)}`;
      }
      if (!combined.trim()) return res.status(400).json({ error: 'Impossible d\'extraire le contenu des pièces sélectionnées.', ignored });

      const { resolveLlmProvider, getPlatformAiConfig } = await import('@zinkh/archioffice-agents/server/llm');
      const provider = resolveLlmProvider(await getPlatformAiConfig(supabaseAdmin));
      const prompt = `${context}

Contenu des pièces :
${combined}

Réponds UNIQUEMENT avec un JSON valide (sans markdown) conforme à ce schéma :
${JSON.stringify(CCTP_SCHEMA)}`;

      const reservedCents = await estimateReserveCents(provider.id, provider.model, Math.ceil((prompt.length + SYSTEM_PROMPT.length) / 4));
      if (!(await reserveAiCredit(tenantId, reservedCents))) {
        return res.status(402).json({ error: 'Crédit IA épuisé. Veuillez recharger votre compte.', code: 'NO_TOKENS' });
      }
      let result;
      try {
        result = await provider.chat({ system: SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }] });
      } catch (e) {
        await refundAiCredit(tenantId, reservedCents).catch(() => {});
        throw e;
      }
      await settleAiCredit({
        tenantId, userId: req.user.id, agentId: null, conversationId: null, endpointType: 'cctp_generation',
        provider: provider.id, model: provider.model, reservedCents,
        inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
      });

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(502).json({ error: 'Réponse IA invalide.' });
      const lots = normalizeGeneratedCctp(JSON.parse(jsonMatch[0]));
      res.json({ engine, lots, documents_read: docs.length - ignored.length, ignored });
    } catch (e: any) {
      if (e?.code === 'LLM_NOT_CONFIGURED') return res.status(503).json({ error: e.message });
      if (e?.name === 'NomicError') return res.status(502).json({ error: e.message });
      console.error('[POST /api/projects/:projectId/cctp/generate]', e?.message);
      Sentry.captureException(e, { tags: { feature: 'cctp-generation' } });
      res.status(500).json({ error: 'Échec de la génération du CCTP : ' + e.message });
    }
  });
}
