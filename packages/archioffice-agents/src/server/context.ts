import type { AgentContext } from '../types.js';
// Pinned to the 1.x line deliberately: pdf-parse@2 depends on @napi-rs/canvas
// (a Rust native binary, for its screenshot/image-rendering features, which
// this file never uses) — that native module's runtime needs system
// libraries (font rendering, etc.) that a minimal server image (this repo's
// Dockerfile is node:22-slim) doesn't ship, so simply reading a PDF crashed
// the whole Node process, not something a try/catch here can guard against.
// 1.x is a pure-JS text-only extractor with zero native dependencies.
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { ocrDocument, isOcrCandidate, OCR_IMAGE_EXTENSIONS } from './ocr.js';

const MAX_DOC_BYTES = 80_000; // ~80KB per document injected into context

// A slow Storage download or a large PDF/DOCX parse must never stall the
// whole chat turn — before real content extraction existed here, this phase
// was a handful of near-instant Supabase table queries, well inside the
// client's 90s and the server's 55s (routes.ts) chat timeouts. Actual file
// I/O + parsing can legitimately take longer, so each document gets its own
// bounded budget and is skipped (like an unreadable document already is) if
// it blows past it, rather than eating into the single Gemini call's own
// timeout budget and surfacing as an opaque "Le service met trop de temps
// à répondre" with no attached document ever having been the actual cause.
const DOC_EXTRACTION_TIMEOUT_MS = 10_000;

// L'OCR (ocr.ts) rend chaque page en image puis la reconnaît : c'est
// nettement plus lent qu'une lecture de couche texte, et le budget ci-dessus
// le rejetterait systématiquement. Les documents qui en ont besoin ont donc
// leur propre enveloppe, appliquée à ce seul chemin.
const OCR_EXTRACTION_TIMEOUT_MS = 60_000;

// Un PDF ou une image PEUT demander un OCR ; on ne le sait qu'après avoir
// tenté l'extraction, donc l'enveloppe de temps est choisie d'après le nom
// avant de commencer.
function isOcrLikely(fileName: string): boolean {
  const lower = String(fileName || '').toLowerCase();
  return lower.endsWith('.pdf') || OCR_IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('document extraction timed out')), ms)),
  ]);
}

// Parses the bucket + object path back out of a stored getPublicUrl()-shaped
// string (…/storage/v1/object/public/<bucket>/<path>) — duplicated in miniature
// from server/storagePaths.ts's parseStorageRef() rather than imported, since
// this package is a self-contained proprietary module (see its package.json)
// and shouldn't reach into the root app's server/ directory.
function parseStorageRef(fileUrl: string): { bucket: string; path: string } | null {
  const marker = '/object/public/';
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  const rest = fileUrl.slice(idx + marker.length);
  const slash = rest.indexOf('/');
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const path = decodeURIComponent(rest.slice(slash + 1));
  return bucket && path ? { bucket, path } : null;
}

// Reads a document's bytes for content extraction. Our own storage buckets
// are private, so this goes through the service-role Storage client (which
// bypasses that privacy, like a table query bypasses RLS) rather than a
// plain fetch() against the stored reference URL, which would 401/403.
// Falls back to a direct fetch for anything that isn't one of our own
// storage refs (e.g. a document imported from an external link).
async function readStorageObject(supabaseAdmin: any, fileUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const ref = parseStorageRef(fileUrl || '');
  if (ref) {
    const { data, error } = await supabaseAdmin.storage.from(ref.bucket).download(ref.path);
    if (error || !data) return null;
    const arrayBuffer = await data.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType: data.type || '' };
  }
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType: res.headers.get('content-type') ?? '' };
  } catch {
    return null;
  }
}

// firm_knowledge is auto-injected on every message (unlike user-attached
// documents), and the tenant is billed per token for it — keep these caps
// tight relative to MAX_DOC_BYTES above.
const MIN_PHASE_SAMPLE = 2; // don't show a phase average derived from a single transition
const MAX_PRICE_CATALOG_ROWS = 40;
const MAX_COST_HISTORY_ROWS = 30;
const MAX_CCTP_EXCERPTS = 5;
const MAX_CCTP_EXCERPT_CHARS = 2000;

function daysBetween(start: string, end: string): number | null {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (isNaN(s) || isNaN(e) || e <= s) return null;
  return Math.round((e - s) / 86_400_000);
}

function average(nums: number[]): number {
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function summarizePhaseBenchmarks(rows: { phase: string; entered_at: string; exited_at: string }[]) {
  const byPhase = new Map<string, number[]>();
  for (const r of rows) {
    const days = daysBetween(r.entered_at, r.exited_at);
    if (days === null) continue;
    const list = byPhase.get(r.phase);
    if (list) list.push(days); else byPhase.set(r.phase, [days]);
  }
  return [...byPhase.entries()]
    .filter(([, days]) => days.length >= MIN_PHASE_SAMPLE)
    .map(([phase, days]) => ({ phase, avgDurationDays: average(days), sampleSize: days.length }))
    .sort((a, b) => b.sampleSize - a.sampleSize);
}

function summarizeCostHistory(rows: { designation: string; unite: string; prix_unitaire_ht: number }[]) {
  const byItem = new Map<string, { unite: string; prices: number[] }>();
  for (const r of rows) {
    if (!r.designation || r.prix_unitaire_ht == null) continue;
    const key = `${r.designation}|${r.unite}`;
    const entry = byItem.get(key);
    if (entry) entry.prices.push(r.prix_unitaire_ht);
    else byItem.set(key, { unite: r.unite, prices: [r.prix_unitaire_ht] });
  }
  return [...byItem.entries()]
    .map(([key, { unite, prices }]) => ({
      designation: key.split('|')[0],
      unite,
      avgPrixUnitaireHt: average(prices),
      occurrences: prices.length,
    }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, MAX_COST_HISTORY_ROWS);
}

export async function buildAgentContext(
  supabaseAdmin: any,
  tenantId: string,
  userId: string,
  scopes: string[],
  attachedDocumentIds: string[] = []
): Promise<AgentContext> {
  const [tenantRes, profileRes] = await Promise.all([
    supabaseAdmin.from('tenants').select('name').eq('id', tenantId).single(),
    supabaseAdmin.from('profiles').select('name').eq('id', userId).single(),
  ]);

  const ctx: AgentContext = {
    tenantName: tenantRes.data?.name ?? 'Cabinet',
    currentDate: new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    currentUserName: profileRes.data?.name ?? 'Utilisateur',
    projects: [],
    contacts: [],
    upcomingMeetings: [],
    recentDocuments: [],
    tasks: [],
    documentContents: [],
    firmKnowledge: { phaseBenchmarks: [], priceCatalog: [], projectCostHistory: [], cctpExcerpts: [] },
  };

  const fetches: Promise<void>[] = [];

  if (scopes.includes('projects')) {
    fetches.push(
      supabaseAdmin.from('projects').select('id, name, status, client, start_date, end_date')
        .eq('tenant_id', tenantId).neq('status', 'Completed')
        .order('updated_at', { ascending: false }).limit(30)
        .then((r: any) => {
          if (r.error) console.warn('[agent context] projects fetch failed:', r.error.message);
          ctx.projects = r.data || [];
        })
    );
  }
  if (scopes.includes('contacts')) {
    fetches.push(
      supabaseAdmin.from('contacts').select('id, first_name, last_name, company_name, email')
        .eq('tenant_id', tenantId).limit(50)
        .then((r: any) => {
          if (r.error) console.warn('[agent context] contacts fetch failed:', r.error.message);
          ctx.contacts = r.data || [];
        })
    );
  }
  if (scopes.includes('meetings')) {
    fetches.push(
      supabaseAdmin.from('meetings').select('id, title, date, project_id')
        .eq('tenant_id', tenantId).gte('date', new Date().toISOString())
        .order('date', { ascending: true }).limit(10)
        .then((r: any) => {
          if (r.error) console.warn('[agent context] meetings fetch failed:', r.error.message);
          ctx.upcomingMeetings = r.data || [];
        })
    );
  }
  if (scopes.includes('documents')) {
    fetches.push(
      supabaseAdmin.from('documents').select('id, name, project_id, phase, uploaded_at, file_url')
        .eq('tenant_id', tenantId).order('uploaded_at', { ascending: false }).limit(15)
        .then((r: any) => {
          if (r.error) console.warn('[agent context] documents fetch failed:', r.error.message);
          ctx.recentDocuments = r.data || [];
        })
    );
  }
  if (scopes.includes('tasks')) {
    fetches.push(
      supabaseAdmin.from('tasks').select('id, title, status, priority, assignee_id, due_date, end_date, project_id')
        .eq('tenant_id', tenantId).neq('status', 'done')
        .order('due_date', { ascending: true }).limit(20)
        .then((r: any) => {
          if (r.error) console.warn('[agent context] tasks fetch failed:', r.error.message);
          ctx.tasks = r.data || [];
        })
    );
  }

  if (scopes.includes('firm_knowledge')) {
    fetches.push(
      supabaseAdmin.from('project_phase_history').select('phase, entered_at, exited_at')
        .eq('tenant_id', tenantId).not('exited_at', 'is', null)
        .then((r: any) => {
          if (r.error) { console.warn('[agent context] firm_knowledge phase history fetch failed:', r.error.message); return; }
          ctx.firmKnowledge.phaseBenchmarks = summarizePhaseBenchmarks(r.data || []);
        })
    );
    fetches.push(
      supabaseAdmin.from('articles_type').select('designation, unite, prix_unitaire, categorie')
        .eq('tenant_id', tenantId).not('prix_unitaire', 'is', null)
        .order('categorie', { ascending: true }).order('designation', { ascending: true })
        .limit(MAX_PRICE_CATALOG_ROWS)
        .then((r: any) => {
          if (r.error) { console.warn('[agent context] firm_knowledge articles_type fetch failed:', r.error.message); return; }
          ctx.firmKnowledge.priceCatalog = r.data || [];
        })
    );
    fetches.push(
      supabaseAdmin.from('dpgf_items').select('designation, unite, prix_unitaire_ht')
        .eq('tenant_id', tenantId).limit(500)
        .then((r: any) => {
          if (r.error) { console.warn('[agent context] firm_knowledge dpgf_items fetch failed:', r.error.message); return; }
          ctx.firmKnowledge.projectCostHistory = summarizeCostHistory(r.data || []);
        })
    );
    fetches.push(
      supabaseAdmin.from('specifications').select('title, content, is_template')
        .eq('tenant_id', tenantId).not('content', 'is', null)
        .order('is_template', { ascending: false }).order('last_updated', { ascending: false })
        .limit(MAX_CCTP_EXCERPTS)
        .then((r: any) => {
          if (r.error) { console.warn('[agent context] firm_knowledge specifications fetch failed:', r.error.message); return; }
          ctx.firmKnowledge.cctpExcerpts = ((r.data || []) as any[])
            .filter((s: any) => s.content && String(s.content).trim().length > 0)
            .map((s: any) => ({ title: s.title, excerpt: String(s.content).slice(0, MAX_CCTP_EXCERPT_CHARS) }));
        })
    );
  }

  // Fetch specific documents attached to this message (overrides scope-based recentDocuments)
  if (attachedDocumentIds.length > 0) {
    fetches.push(
      supabaseAdmin.from('documents').select('id, name, project_id, phase, uploaded_at, file_url')
        .eq('tenant_id', tenantId).in('id', attachedDocumentIds)
        .then((r: any) => { ctx.recentDocuments = r.data || []; })
    );
  }

  await Promise.all(fetches);

  // RAG — fetch content of explicitly attached documents
  if (attachedDocumentIds.length > 0) {
    const { data: docs } = await supabaseAdmin
      .from('documents')
      .select('id, name, file_url')
      .eq('tenant_id', tenantId)
      .in('id', attachedDocumentIds);

    const contentFetches = ((docs as any[]) || []).map((doc: any) => {
      const docStart = Date.now();
      return withTimeout((async () => {
      try {
        const lowerName = String(doc.name || '').toLowerCase();

        // documents.file_url is stored as a getPublicUrl()-shaped string,
        // but the "documents" bucket (like every other business-document
        // bucket) is private — a plain fetch() against it 401/403s (see
        // server/storagePaths.ts). That silently broke content extraction
        // for every attached document, not just PDFs: the PDF/DOCX parsing
        // added here never actually worked end-to-end in production because
        // the byte fetch it was built on top of was already failing before
        // it ever got to parse anything. The service-role client can read
        // the object directly via Storage's download() API instead, which
        // bypasses the bucket's privacy the same way a table query bypasses
        // RLS — no signed URL needed.
        const fetched = await readStorageObject(supabaseAdmin, doc.file_url);
        if (!fetched) return;
        const { buffer, contentType } = fetched;

        let text: string | null = null;
        let ocrNote = '';
        if (lowerName.endsWith('.pdf')) {
          // CCTP, RC and other tender/contract documents are almost always
          // PDFs — this used to be silently dropped by the content-type
          // check below (application/pdf matches none of text/json/csv/xml),
          // so an attached PDF's metadata showed up in the prompt but its
          // content never did, and the agent would truthfully say it never
          // received the document.
          text = (await pdfParse(buffer)).text;
        } else if (lowerName.endsWith('.docx')) {
          text = (await mammoth.extractRawText({ buffer })).value;
        } else if (contentType.includes('text') || contentType.includes('json') || contentType.includes('csv') || contentType.includes('xml')) {
          // Everything else without a dedicated extractor above (images,
          // spreadsheets, legacy .doc...) — only inject text-based content,
          // never binary bytes as if they were readable text.
          text = buffer.toString('utf8');
        } else if (!OCR_IMAGE_EXTENSIONS.some(ext => lowerName.endsWith(ext))) {
          return;
        }

        // PDF scanné (aucune couche texte exploitable) ou image : dernier
        // recours par reconnaissance de caractères. Le résultat remplace le
        // texte vide, et si l'OCR n'est pas disponible sur ce serveur on
        // injecte la raison plutôt que rien, pour que l'agent puisse le dire.
        if (isOcrCandidate(lowerName, text)) {
          const ocrStart = Date.now();
          const ocr = await ocrDocument(lowerName, buffer).catch((e: any) => {
            console.log(`[agent context] OCR failed for "${doc.name}": ${e?.message}`);
            return null;
          });
          if (ocr?.text?.trim()) {
            text = ocr.text;
            ocrNote = `[Document sans couche texte : contenu reconstitué par OCR sur ${ocr.pages} page(s). Des erreurs de reconnaissance sont possibles.]\n\n`;
            console.log(`[agent context] document "${doc.name}" OCR'd in ${Date.now() - ocrStart}ms (${ocr.pages} pages, ${ocr.text.length} chars)`);
          } else if (ocr?.unavailableReason && !text?.trim()) {
            ctx.documentContents.push({
              id: doc.id,
              name: doc.name,
              content: `[Ce document ne contient pas de texte sélectionnable (document scanné) et n'a pas pu être lu : ${ocr.unavailableReason}. Dis-le explicitement à l'utilisateur et propose-lui de fournir une version texte.]`,
            });
            return;
          }
        }

        if (!text || !text.trim()) return;
        ctx.documentContents.push({
          id: doc.id,
          name: doc.name,
          content: ocrNote + text.slice(0, MAX_DOC_BYTES),
        });
        console.log(`[agent context] document "${doc.name}" extracted in ${Date.now() - docStart}ms (${text.length} chars)`);
      } catch (e: any) {
        // skip unreadable documents silently, but still log it — same
        // reasoning as the timing logs in routes.ts: an extraction failure
        // here was previously invisible, indistinguishable from "the
        // document just has no useful content".
        console.log(`[agent context] document "${doc.name}" extraction failed after ${Date.now() - docStart}ms: ${e?.message}`);
      }
    })(), isOcrLikely(doc.name) ? OCR_EXTRACTION_TIMEOUT_MS : DOC_EXTRACTION_TIMEOUT_MS).catch(() => {
      // Timed out (or any other rejection) — skip this document, same as an
      // extraction error above.
      console.log(`[agent context] document "${doc.name}" extraction timed out after ${Date.now() - docStart}ms`);
    });
    });

    await Promise.all(contentFetches);
  }

  return ctx;
}
