import { Router, Request, Response } from 'express';
import type { CloudSyncHandle } from './cloudSync';

export function createCloudSyncRouter(cloudSync: CloudSyncHandle): Router {
  const router = Router();

  router.get('/status', async (req: Request, res: Response) => {
    res.json(await cloudSync.getStatus());
  });

  router.post('/now', (req: Request, res: Response) => {
    cloudSync.triggerNow();
    res.json({ triggered: true });
  });

  return router;
}
