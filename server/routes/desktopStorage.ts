// Routes propres au client de bureau (Electron) pour les fichiers du cabinet.
//
// Toutes répondent 404 hors du client de bureau (OFFLINE_MODE) : sur le serveur
// hébergé il n'existe ni dossier de stockage local à ouvrir ni arborescence à migrer.
//
//  - GET /api/storage/local-file : transforme la référence d'un fichier en clé de
//    stockage locale (bucket + chemin), pour les boutons « Afficher dans
//    l'Explorateur » et « Ouvrir ». Le processus principal d'Electron n'a pas de
//    base de données : c'est ici que se fait la vérification d'appartenance, avec la
//    règle de storageAccess.ts (le chemin commence par `<cabinet>/`). Le client ne
//    fournit JAMAIS un chemin de disque : Electron reconstruit le sien à partir de
//    cette clé et de son propre dossier de stockage.
//  - /api/storage/tree-migration/* : migration des fichiers existants vers
//    l'arborescence lisible (server/storageTreeMigration.ts), administrateurs
//    seulement. La copie tourne en tâche de fond (des milliers de fichiers dépassent
//    le délai d'une requête) et son avancement se relit.
import type { Express } from 'express';
import fs from 'fs';
import { createDocumentFolderResolver } from '../externalStorage/documentFolders';
import { PRIVATE_STORAGE_BUCKETS, parseStorageRef } from '../storagePaths';
import {
  purgeLegacyFiles,
  resolveInBucket,
  runTreeMigration,
  type MigrationDeps,
  type MigrationReport,
} from '../storageTreeMigration';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => Promise<void>;
  /** Dossier d'un bucket : `storageDir(bucket)`. */
  storageRoot: (bucket: string) => string;
  /** URL publique d'un chemin d'objet, telle que les dépôts l'écrivent dans `file_url`. */
  publicUrl: (bucket: string, objectPath: string) => string;
  /** Fichier JSON qui garde la liste des anciens chemins copiés. Une fonction, lue au
   *  moment de l'appel : `storageDir()` crée des dossiers, ce qui ne doit jamais se
   *  produire à l'enregistrement des routes sur le serveur hébergé. */
  journalPath: () => string;
}

interface MigrationJob {
  status: 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt?: string;
  processed: number;
  total: number;
  report?: MigrationReport;
  error?: string;
}

/** Un travail par cabinet, en mémoire : un redémarrage le perd, ce qui est sans
 *  conséquence puisque la migration est reprenable (voir storageTreeMigration.ts). */
const jobs = new Map<string, MigrationJob>();

function desktopOnly(_req: any, res: any, next: any) {
  if (process.env.OFFLINE_MODE !== 'true') {
    return res.status(404).json({ error: 'Disponible dans le client de bureau uniquement.' });
  }
  next();
}

export function registerDesktopStorageRoutes(app: Express, deps: RouteDeps) {
  const { supabaseAdmin, getTenantId, requireRole, storageRoot, publicUrl, journalPath } = deps;

  const migrationDeps = (): MigrationDeps => ({
    db: supabaseAdmin,
    resolver: createDocumentFolderResolver(supabaseAdmin),
    storageRoot,
    publicUrl,
    journalPath: journalPath(),
  });

  app.get('/api/storage/local-file', desktopOnly, async (req: any, res: any) => {
    try {
      const fileUrl = String(req.query.url ?? '');
      if (!fileUrl) return res.status(400).json({ error: "Paramètre 'url' requis" });

      const ref = parseStorageRef(fileUrl);
      if (!ref || !PRIVATE_STORAGE_BUCKETS.has(ref.bucket)) {
        // Référence externe (Drive du cabinet), URL étrangère : rien à ouvrir en local.
        return res.json({ available: false });
      }
      const tenantId = await getTenantId(req.user.id);
      if (!ref.path.startsWith(`${tenantId}/`)) return res.status(403).json({ error: 'Accès refusé' });

      const file = resolveInBucket(storageRoot(ref.bucket), ref.path);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.json({ available: false });
      res.json({ available: true, bucket: ref.bucket, path: ref.path });
    } catch (e: any) {
      console.error('[GET /api/storage/local-file]', e);
      res.status(e.status || 500).json({ error: e.message || 'Échec de la résolution du fichier' });
    }
  });

  app.get('/api/storage/tree-migration', desktopOnly, requireRole('admin'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      res.json({ job: jobs.get(tenantId) ?? null });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Échec de la lecture' });
    }
  });

  app.post('/api/storage/tree-migration/preview', desktopOnly, requireRole('admin'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      res.json(await runTreeMigration(migrationDeps(), tenantId, { dryRun: true }));
    } catch (e: any) {
      console.error('[POST /api/storage/tree-migration/preview]', e);
      res.status(e.status || 500).json({ error: e.message || 'Échec de la simulation' });
    }
  });

  app.post('/api/storage/tree-migration/start', desktopOnly, requireRole('admin'), async (req: any, res: any) => {
    try {
      // Une copie de plusieurs gigaoctets ne se lance pas par un clic de travers.
      if (req.body?.confirm !== true) {
        return res.status(400).json({ error: 'Confirmation requise (confirm: true).' });
      }
      const tenantId = await getTenantId(req.user.id);
      const current = jobs.get(tenantId);
      if (current?.status === 'running') {
        return res.status(409).json({ error: 'Une migration est déjà en cours.', job: current });
      }

      const job: MigrationJob = { status: 'running', startedAt: new Date().toISOString(), processed: 0, total: 0 };
      jobs.set(tenantId, job);
      runTreeMigration(migrationDeps(), tenantId, {
        dryRun: false,
        onProgress: (done, total) => { job.processed = done; job.total = total; },
      })
        .then((report) => { job.status = 'done'; job.report = report; })
        .catch((err) => { job.status = 'error'; job.error = err?.message || String(err); })
        .finally(() => { job.finishedAt = new Date().toISOString(); });

      res.status(202).json({ job });
    } catch (e: any) {
      console.error('[POST /api/storage/tree-migration/start]', e);
      res.status(e.status || 500).json({ error: e.message || 'Échec du lancement' });
    }
  });

  app.post('/api/storage/tree-migration/purge', desktopOnly, requireRole('admin'), async (req: any, res: any) => {
    try {
      const dryRun = req.body?.dryRun !== false;
      // Supprimer des fichiers ne se fait jamais par défaut ni sans confirmation.
      if (!dryRun && req.body?.confirm !== true) {
        return res.status(400).json({ error: 'Confirmation requise (confirm: true).' });
      }
      const tenantId = await getTenantId(req.user.id);
      if (jobs.get(tenantId)?.status === 'running') {
        return res.status(409).json({ error: 'Une migration est en cours : attendez sa fin.' });
      }
      res.json(await purgeLegacyFiles(migrationDeps(), tenantId, { dryRun }));
    } catch (e: any) {
      console.error('[POST /api/storage/tree-migration/purge]', e);
      res.status(e.status || 500).json({ error: e.message || 'Échec du nettoyage' });
    }
  });
}
