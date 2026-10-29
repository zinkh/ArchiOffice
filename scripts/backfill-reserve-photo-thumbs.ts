// One-off maintenance script: crée la miniature d'affichage (480 px) des photos de réserves envoyées
// AVANT que le serveur n'en génère à l'envoi (server/reservePhotos.ts). Sans miniature, l'écran affiche
// la photo complète : rien n'est cassé, seulement plus lourd.
//
// Ne touche jamais à la photo elle-même ni à une ligne qui a déjà sa miniature : on peut le relancer
// sans risque, y compris après une interruption. Une image déjà plus petite que la miniature n'en reçoit
// pas (elle serait identique à la photo).
//
// Prérequis : supabase/migrate_reserve_photos_thumb.sql (colonne `thumb_url`).
//
// Usage:
//   npx tsx scripts/backfill-reserve-photo-thumbs.ts            # applique
//   npx tsx scripts/backfill-reserve-photo-thumbs.ts --dry-run   # compte seulement
import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { sniffImageMime, makeThumbnail, extensionForImageMime } from '../server/imageUpload';
import { parseStorageRef } from '../server/storagePaths';

const DRY_RUN = process.argv.includes('--dry-run');
const BUCKET = 'reserve-photos';
const PAGE_SIZE = 200;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env).');
  process.exit(1);
}

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

interface PhotoRow { id: string; tenant_id: string; reserve_id: string; file_url: string }

type Outcome = 'created' | 'skipped' | 'failed';

async function processPhoto(photo: PhotoRow): Promise<Outcome> {
  const ref = parseStorageRef(photo.file_url);
  if (!ref || ref.bucket !== BUCKET) {
    console.log(`  - ${photo.id}: référence de stockage non reconnue, ignorée`);
    return 'skipped';
  }
  const { data: blob, error: downloadError } = await supabaseAdmin.storage.from(BUCKET).download(ref.path);
  if (downloadError || !blob) {
    console.error(`  ! ${photo.id}: téléchargement impossible (${downloadError?.message})`);
    return 'failed';
  }
  const original = Buffer.from(await blob.arrayBuffer());
  const mime = sniffImageMime(original);
  if (!mime) {
    console.log(`  - ${photo.id}: format d'image non reconnu, ignorée`);
    return 'skipped';
  }
  const thumb = await makeThumbnail(original, mime);
  if (!thumb) return 'skipped'; // déjà plus petite que la miniature, ou illisible

  const thumbPath = `${photo.tenant_id}/${photo.reserve_id}/${photo.id}-thumb.${extensionForImageMime(thumb.mimetype)}`;
  console.log(`  ✓ ${photo.id}: ${(original.length / 1024).toFixed(0)} Ko → ${(thumb.buffer.length / 1024).toFixed(0)} Ko`);
  if (DRY_RUN) return 'created';

  // `upsert: true` : une relance après interruption retrouve une miniature déjà déposée sans échouer.
  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(thumbPath, thumb.buffer, { contentType: thumb.mimetype, upsert: true });
  if (uploadError) {
    console.error(`  ! ${photo.id}: dépôt de la miniature impossible (${uploadError.message})`);
    return 'failed';
  }
  const { data: publicUrl } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(thumbPath);
  const { error: updateError } = await supabaseAdmin.from('reserve_photos').update({ thumb_url: publicUrl.publicUrl }).eq('id', photo.id);
  if (updateError) {
    console.error(`  ! ${photo.id}: enregistrement impossible (${updateError.message})`);
    await supabaseAdmin.storage.from(BUCKET).remove([thumbPath]).catch(() => {});
    return 'failed';
  }
  return 'created';
}

async function main() {
  console.log(DRY_RUN ? 'Simulation : rien ne sera modifié.\n' : 'Création des miniatures.\n');
  const counts: Record<Outcome, number> = { created: 0, skipped: 0, failed: 0 };
  let lastId = '';

  // Pagination par identifiant : les lignes traitées sortent du filtre `thumb_url IS NULL`, mais celles
  // ignorées y restent, donc un décalage (offset) les ferait boucler ou en sauter.
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('reserve_photos')
      .select('id, tenant_id, reserve_id, file_url')
      .is('thumb_url', null)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (error) {
      console.error(`Lecture impossible : ${error.message}\n(la migration supabase/migrate_reserve_photos_thumb.sql est-elle appliquée ?)`);
      process.exit(1);
    }
    const rows = (data || []) as PhotoRow[];
    if (rows.length === 0) break;
    for (const photo of rows) counts[await processPhoto(photo)]++;
    lastId = rows[rows.length - 1].id;
    if (rows.length < PAGE_SIZE) break;
  }

  console.log('\n── Résumé ─────────────────────────────');
  console.log(`Miniatures créées${DRY_RUN ? ' (simulation)' : ''} : ${counts.created}`);
  console.log(`Ignorées (déjà petites, format inconnu) : ${counts.skipped}`);
  console.log(`En échec : ${counts.failed}`);
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
