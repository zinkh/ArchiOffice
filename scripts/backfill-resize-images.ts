// One-off maintenance script: shrinks avatars, the agency logo, and meeting
// photos that were uploaded before server/imageUpload.ts started resizing
// on the way in (server/routes/uploads.ts, server/routes/meetings.ts).
// Everything already within its target's dimension cap is left completely
// untouched — safe to re-run, including on a tenant that's already been
// processed.
//
// Usage:
//   npx tsx scripts/backfill-resize-images.ts            # applies changes
//   npx tsx scripts/backfill-resize-images.ts --dry-run   # report only
import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { sniffImageMime, resizeImage, AVATAR_MAX_DIMENSION, LOGO_MAX_DIMENSION, MEETING_PHOTO_MAX_DIMENSION } from '../server/imageUpload';

const DRY_RUN = process.argv.includes('--dry-run');
const LIST_PAGE_SIZE = 1000;
const MAX_RECURSION_DEPTH = 6; // storage paths here are 2-3 levels deep — this is just a runaway guard

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env).');
  process.exit(1);
}

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

interface Target {
  bucket: string;
  // Picks the dimension cap for a given object path within the bucket —
  // "logos" holds two unrelated things at different paths (see
  // server/routes/uploads.ts): tenant logos at `{tenantId}/logo/...` and
  // user avatars at `avatars/{userId}/...`.
  maxDimensionFor: (path: string) => number;
}

const TARGETS: Target[] = [
  { bucket: 'logos', maxDimensionFor: path => (path.startsWith('avatars/') ? AVATAR_MAX_DIMENSION : LOGO_MAX_DIMENSION) },
  { bucket: 'meeting-photos', maxDimensionFor: () => MEETING_PHOTO_MAX_DIMENSION },
];

interface StorageFile {
  path: string; // full path within the bucket
}

// Supabase Storage's list() is one directory level at a time (folders come
// back as entries with id: null, no metadata) — walk it manually to find
// every file, however deeply tenant/user ids happen to nest them.
async function listFilesRecursive(bucket: string, prefix: string, depth = 0): Promise<StorageFile[]> {
  if (depth > MAX_RECURSION_DEPTH) return [];
  const files: StorageFile[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(prefix, { limit: LIST_PAGE_SIZE, offset });
    if (error) {
      console.error(`  ! list(${bucket}, "${prefix}") failed: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        // Folder pseudo-entry — recurse.
        files.push(...await listFilesRecursive(bucket, fullPath, depth + 1));
      } else {
        files.push({ path: fullPath });
      }
    }

    if (data.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
  return files;
}

async function processFile(bucket: string, filePath: string, maxDimension: number) {
  const { data: blob, error: downloadError } = await supabaseAdmin.storage.from(bucket).download(filePath);
  if (downloadError || !blob) {
    console.error(`  ! download failed for ${bucket}/${filePath}: ${downloadError?.message}`);
    return { resized: false, before: 0, after: 0 };
  }
  const original = Buffer.from(await blob.arrayBuffer());
  const mime = sniffImageMime(original);
  if (!mime) {
    console.log(`  - ${filePath}: not a recognized image format, skipped`);
    return { resized: false, before: original.length, after: original.length };
  }

  const { buffer: resized, mimetype } = await resizeImage(original, mime, maxDimension);
  if (resized.length >= original.length) {
    // Either already within bounds, or (rarely) the re-encode came out
    // larger — either way, storing it would be pointless or harmful.
    return { resized: false, before: original.length, after: original.length };
  }

  console.log(`  ✓ ${filePath}: ${(original.length / 1024).toFixed(0)} KB → ${(resized.length / 1024).toFixed(0)} KB`);
  if (!DRY_RUN) {
    const { error: updateError } = await supabaseAdmin.storage.from(bucket).update(filePath, resized, { contentType: mimetype });
    if (updateError) {
      console.error(`  ! upload of resized ${bucket}/${filePath} failed: ${updateError.message}`);
      return { resized: false, before: original.length, after: original.length };
    }
  }
  return { resized: true, before: original.length, after: resized.length };
}

async function main() {
  console.log(DRY_RUN ? 'Dry run — no files will be modified.\n' : 'Applying changes.\n');

  let totalFiles = 0;
  let totalResized = 0;
  let totalBytesBefore = 0;
  let totalBytesAfter = 0;

  for (const target of TARGETS) {
    console.log(`Bucket: ${target.bucket}`);
    const files = await listFilesRecursive(target.bucket, '');
    console.log(`  ${files.length} file(s) found`);

    for (const file of files) {
      totalFiles++;
      const maxDimension = target.maxDimensionFor(file.path);
      const result = await processFile(target.bucket, file.path, maxDimension);
      totalBytesBefore += result.before;
      totalBytesAfter += result.after;
      if (result.resized) totalResized++;
    }
    console.log('');
  }

  const savedMB = (totalBytesBefore - totalBytesAfter) / (1024 * 1024);
  console.log('── Summary ─────────────────────────────');
  console.log(`Files scanned:  ${totalFiles}`);
  console.log(`Files resized:  ${totalResized}${DRY_RUN ? ' (would be)' : ''}`);
  console.log(`Space saved:    ${savedMB.toFixed(1)} MB`);
  if (DRY_RUN) console.log('\nRe-run without --dry-run to apply.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
