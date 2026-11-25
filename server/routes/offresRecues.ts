// Lecture des montants probables dans une pièce d'offre reçue HORS plateforme (PDF, Word, Excel, ODS, ODT remis
// par e-mail, clé USB ou courrier, rangés dans les documents de l'affaire par l'import d'offre de l'ACT).
//
// Même lecture que les remises du portail (`analyserFichier` : texte puis règles, sans modèle ni coût ni OCR) :
// une SUGGESTION que l'architecte confirme, jamais appliquée seule. Différence voulue : le portail de dépôt exige
// le plan Enterprise, cette lecture n'a besoin d'aucun lien ni espace de stockage externe et s'ouvre dès le plan
// Pro. La route ne lit que les documents de CETTE affaire, de CE cabinet, de la catégorie réservée aux offres
// reçues ; les octets sont revérifiés (`verifierOctets`) avant d'être lus.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { parseExternalRef } from '../externalStorage/externalRef';
import { getConnectionById } from '../externalStorage/externalConnection';
import { createProvider } from '../externalStorage/providerFactory';
import { ExternalFolderMissingError } from '../externalStorage/provider';
import { analyserFichier } from '../consultationDepot/analyse';
import { verifierOctets } from '../consultationDepot/fileRules';
import { aiGenerationLimiter } from '../rateLimit';
import { isPlanAtLeast } from '../../src/lib/billing';
import { CATEGORIE_OFFRES_RECUES, TAILLE_MAX_PIECE, estLisible } from '../../src/lib/offresRecues';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getTenantPlan: (tenantId: string) => Promise<{ plan: string }>;
}

class FichierTropGros extends Error {}

export function registerOffresRecuesRoutes(app: Express, { supabaseAdmin, getTenantId, getTenantPlan }: RouteDeps) {
  /** Octets du document, qu'il soit sur l'espace de stockage externe du cabinet ou sur Supabase Storage. Null si inaccessible. */
  async function lireOctets(tenantId: string, fileUrl: string): Promise<Buffer | null> {
    const ref = parseExternalRef(fileUrl);
    if (ref) {
      const connexion = await getConnectionById(supabaseAdmin, tenantId, ref.connectionId);
      if (!connexion) return null;
      // Fichier supprimé ou déplacé depuis le drive : « inaccessible » (404), pas une panne du serveur.
      const flux = await createProvider(connexion).openReadStream(ref.externalId).catch((e: unknown) => {
        if (e instanceof ExternalFolderMissingError) return null;
        throw e;
      });
      if (!flux) return null;
      const morceaux: Buffer[] = [];
      let total = 0;
      for await (const m of flux.body) {
        const b = Buffer.from(m as any);
        total += b.length;
        if (total > TAILLE_MAX_PIECE + 1024) throw new FichierTropGros();
        morceaux.push(b);
      }
      return Buffer.concat(morceaux);
    }
    const { readStorageObject } = await import('@zinkh/archioffice-agents/server');
    const lu = await readStorageObject(supabaseAdmin, tenantId, fileUrl);
    if (!lu) return null;
    if (lu.buffer.length > TAILLE_MAX_PIECE + 1024) throw new FichierTropGros();
    return lu.buffer;
  }

  app.post('/api/projects/:projectId/offres-recues/:documentId/analyser', aiGenerationLimiter, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { plan } = await getTenantPlan(tenantId);
      if (!isPlanAtLeast(plan, 'pro')) {
        return res.status(403).json({
          error: 'La lecture des montants des offres reçues est réservée au plan Pro et aux plans supérieurs.',
          code: 'plan_requis',
        });
      }

      const { data: doc } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents')
        .select('id, name, category, file_url, project_id')
        .eq('id', req.params.documentId).eq('project_id', req.params.projectId).maybeSingle();
      if (!doc || (doc as any).category !== CATEGORIE_OFFRES_RECUES || !(doc as any).file_url) {
        return res.status(404).json({ error: 'Pièce introuvable dans les offres reçues de cette affaire.' });
      }
      const nom: string = (doc as any).name || '';
      if (!estLisible(nom)) {
        return res.status(400).json({ error: 'Ce format ne se lit pas automatiquement (PDF, Word, Excel, ODS ou ODT seulement). Ouvrez le document pour lire le montant.' });
      }

      const octets = await lireOctets(tenantId, (doc as any).file_url);
      if (!octets) return res.status(404).json({ error: "Le fichier n'est plus accessible depuis l'espace de stockage du cabinet." });

      const controle = verifierOctets(nom, octets);
      if (!controle.ok) return res.status(400).json({ error: `Lecture refusée : ${(controle as any).raison || 'contenu non autorisé.'}` });

      res.json(await analyserFichier(nom, octets));
    } catch (err: any) {
      if (err instanceof FichierTropGros) return res.status(413).json({ error: 'Fichier trop volumineux pour être lu.' });
      console.error('[POST offres-recues/analyser]', err?.message);
      res.status(500).json({ error: err?.message?.includes('délai') ? err.message : 'La lecture du document a échoué.' });
    }
  });
}
