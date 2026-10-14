// Résolution des données d'un dossier de références, par affaire.
//
// Garantie « aucune image d'un autre projet » : chaque image candidate est
// relue en base et n'est acceptée que si elle appartient bien à la référence
// demandée ET au cabinet (document dont project_id / resource_id est cette
// référence, entrée `images` de cette référence manuelle, couverture de cette
// affaire). Un identifiant étranger est ignoré et signalé, jamais embarqué.
import { Jimp, JimpMime } from 'jimp';
import { sniffImageMime } from '../imageUpload';
import { parseStorageRef } from '../storagePaths';
import {
  agencyAcronym, cleanText, deriveCityDept, parseAmount,
} from './format';
import type { DossierAgency, ReferenceSheetData, SheetImage } from './types';

export type ReferenceSource = 'project' | 'manual';

export interface ReferenceSelection {
  source: ReferenceSource;
  id: string;
  /** Images retenues, dans l'ordre ; vide = celles de la fiche, à défaut la couverture. */
  imageIds?: string[];
  primaryImageId?: string | null;
  /** Texte du programme modifié pour cet export seulement (jamais enregistré). */
  programOverride?: string | null;
  /** Ne charge aucune image (aperçu des valeurs par défaut d'une fiche). */
  skipImages?: boolean;
}

export interface ImageCandidate {
  /** `cover`, `doc:<id du document>` ou `img:<id>` (galerie d'une référence manuelle). */
  id: string;
  label: string;
  kind: 'cover' | 'document' | 'gallery';
}

const MAX_IMAGES = 6;
const MAX_IMAGE_DIMENSION = 1800;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
export const REFERENCE_IMAGE_CATEGORY = 'Références - images';

type Db = any;

function isMissingTable(error: any): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205');
}

// ── Images ──────────────────────────────────────────────────────────────────

async function bytesFromRef(db: Db, ref: string): Promise<Buffer | null> {
  if (ref.startsWith('data:')) {
    const comma = ref.indexOf(',');
    if (comma === -1) return null;
    return Buffer.from(ref.slice(comma + 1), ref.slice(0, comma).includes(';base64') ? 'base64' : 'utf8');
  }
  const parsed = parseStorageRef(ref);
  if (!parsed) return null; // référence externe (drive du cabinet) ou URL étrangère : non lue ici
  const { data, error } = await db.storage.from(parsed.bucket).download(parsed.path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Réduit l'image (1800 px, JPEG) : le PDF ne doit pas embarquer des photos de plusieurs Mo. */
export async function toJpegDataUrl(buffer: Buffer): Promise<string | null> {
  if (buffer.length === 0 || buffer.length > MAX_SOURCE_BYTES) return null;
  const mime = sniffImageMime(buffer);
  if (!mime) return null;
  try {
    const image = await Jimp.read(buffer);
    const { width, height } = image.bitmap;
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      image.scaleToFit({ w: MAX_IMAGE_DIMENSION, h: MAX_IMAGE_DIMENSION });
    }
    const out = await image.getBuffer(JimpMime.jpeg, { quality: 82 });
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch {
    // WebP (pas d'encodeur Jimp) ou décodage impossible : image d'origine si elle est supportée par Chromium.
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }
}

interface RawProject { id: string; image_url?: string | null; [k: string]: any }
interface RawCustom { id: string; image_url?: string | null; images?: Array<{ id: string; url: string; is_primary?: boolean }> | null; [k: string]: any }

async function projectDocImages(db: Db, tenantId: string, projectId: string): Promise<Array<{ id: string; name: string; file_url: string }>> {
  const { data } = await db.from('documents').select('id, name, file_url, category, mime_type')
    .eq('tenant_id', tenantId).eq('project_id', projectId);
  return (data || []).filter((d: any) =>
    d.category === REFERENCE_IMAGE_CATEGORY || (d.mime_type ? String(d.mime_type).startsWith('image/') : IMAGE_EXT.test(d.name || '')));
}

async function customDocImages(db: Db, tenantId: string, customId: string): Promise<Array<{ id: string; name: string; file_url: string }>> {
  const { data } = await db.from('documents').select('id, name, file_url')
    .eq('tenant_id', tenantId).eq('resource_type', 'custom_references').eq('resource_id', customId);
  return data || [];
}

/** Images proposables pour une référence (couverture, documents de l'affaire ou de la référence, galerie). */
export async function listImageCandidates(db: Db, tenantId: string, source: ReferenceSource, id: string): Promise<ImageCandidate[]> {
  const out: ImageCandidate[] = [];
  if (source === 'project') {
    const { data: p } = await db.from('projects').select('id, image_url').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
    if (!p) return [];
    if (p.image_url) out.push({ id: 'cover', label: 'Image de couverture', kind: 'cover' });
    for (const d of await projectDocImages(db, tenantId, id)) out.push({ id: `doc:${d.id}`, label: d.name, kind: 'document' });
  } else {
    const { data: c } = await db.from('custom_references').select('id, image_url, images').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
    if (!c) return [];
    const gallery = Array.isArray(c.images) ? c.images : [];
    if (gallery.length === 0 && c.image_url) out.push({ id: 'cover', label: 'Image principale', kind: 'cover' });
    gallery.forEach((g: any, i: number) => out.push({ id: `img:${g.id}`, label: `Image ${i + 1}`, kind: 'gallery' }));
    for (const d of await customDocImages(db, tenantId, id)) out.push({ id: `doc:${d.id}`, label: d.name, kind: 'document' });
  }
  return out;
}

/** Octets d'une image candidate, après contrôle d'appartenance. null si elle n'appartient pas à cette référence. */
async function loadCandidate(
  db: Db, tenantId: string, source: ReferenceSource, entity: RawProject | RawCustom, candidateId: string,
  docs: Array<{ id: string; name: string; file_url: string }>,
): Promise<SheetImage | null> {
  let ref: string | null = null;
  if (candidateId === 'cover') ref = entity.image_url ?? null;
  else if (candidateId.startsWith('doc:')) ref = docs.find(d => d.id === candidateId.slice(4))?.file_url ?? null;
  else if (candidateId.startsWith('img:') && source === 'manual') {
    ref = (entity as RawCustom).images?.find(g => g.id === candidateId.slice(4))?.url ?? null;
  }
  if (!ref) return null;
  const bytes = await bytesFromRef(db, ref);
  const dataUrl = bytes ? await toJpegDataUrl(bytes) : null;
  return dataUrl ? { id: candidateId, dataUrl } : null;
}

// ── Cabinet ─────────────────────────────────────────────────────────────────

export async function loadAgency(db: Db, tenantId: string, managerOverride?: string | null): Promise<DossierAgency> {
  const { data: s } = await db.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle();
  let logoDataUrl: string | null = null;
  const logo = cleanText(s?.logo_url);
  if (logo) {
    const bytes = logo.startsWith('data:') || logo.includes('/object/public/') ? await bytesFromRef(db, logo).catch(() => null) : null;
    logoDataUrl = bytes ? await logoDataUrlFromBytes(bytes) : null;
  }
  const name = cleanText(s?.agency_name) ?? 'Cabinet d’architecture';
  return {
    name,
    acronym: agencyAcronym(name),
    manager: cleanText(managerOverride) ?? cleanText(s?.architect_name),
    address: cleanText(s?.address),
    phone: cleanText(s?.phone),
    email: cleanText(s?.email),
    siret: cleanText(s?.siret),
    oaNumber: cleanText(s?.oa_number),
    vatNumber: cleanText(s?.vat_number),
    logoDataUrl,
  };
}

/** Logo : PNG conservé tel quel (transparence), sans réduction JPEG. */
async function logoDataUrlFromBytes(bytes: Buffer): Promise<string | null> {
  const mime = sniffImageMime(bytes);
  return mime ? `data:${mime};base64,${bytes.toString('base64')}` : null;
}

// ── Fiches ──────────────────────────────────────────────────────────────────

interface SheetRow {
  nature?: string | null; city?: string | null; department?: string | null; labels?: string | null;
  maitre_oeuvre?: string | null; mission?: string | null; phase?: string | null; amount_text?: string | null;
  images?: Array<{ id: string; is_primary?: boolean }> | null;
}

async function loadSheetRow(db: Db, tenantId: string, source: ReferenceSource, id: string): Promise<SheetRow | null> {
  const { data, error } = await db.from('reference_sheets').select('*').eq('tenant_id', tenantId)
    .eq(source === 'project' ? 'project_id' : 'custom_reference_id', id).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null; // instance sans la migration : tout reste « NC »
    throw error;
  }
  return data ?? null;
}

function yearOf(...dates: Array<string | null | undefined>): string | null {
  for (const d of dates) {
    const m = d ? /^(\d{4})/.exec(String(d)) : null;
    if (m) return m[1];
  }
  return null;
}

async function projectMission(db: Db, tenantId: string, projectId: string): Promise<string | null> {
  const { data } = await db.from('contrats_moe').select('missions_list').eq('tenant_id', tenantId).eq('project_id', projectId).limit(1).maybeSingle();
  const list = Array.isArray(data?.missions_list) ? data.missions_list : [];
  const names = list.filter((m: any) => m?.incluse && m?.name).map((m: any) => String(m.name));
  return names.length ? names.join(', ') : null;
}

/** Cotraitants de l'affaire (nom du contact), pour « avec X, Y » dans le maître d'œuvre. */
async function projectCotraitantNames(db: Db, tenantId: string, projectId: string): Promise<string[]> {
  const { data: rows } = await db.from('project_cotraitants').select('contact_id').eq('tenant_id', tenantId).eq('project_id', projectId);
  const ids = (rows || []).map((r: any) => r.contact_id).filter(Boolean);
  if (!ids.length) return [];
  const { data: contacts } = await db.from('contacts').select('id, first_name, last_name, company_name').eq('tenant_id', tenantId).in('id', ids);
  return (contacts || []).map((c: any) => cleanText(c.company_name) ?? cleanText(`${c.first_name ?? ''} ${c.last_name ?? ''}`)).filter((n: string | null): n is string => !!n);
}

export interface ResolvedDossier {
  references: ReferenceSheetData[];
  warnings: string[];
}

export async function resolveReferences(
  db: Db, tenantId: string, agency: DossierAgency, selections: ReferenceSelection[],
): Promise<ResolvedDossier> {
  const references: ReferenceSheetData[] = [];
  const warnings: string[] = [];

  for (const sel of selections) {
    const sheet = await loadSheetRow(db, tenantId, sel.source, sel.id);
    let entity: any;
    let docs: Array<{ id: string; name: string; file_url: string }> = [];
    if (sel.source === 'project') {
      const { data } = await db.from('projects').select('*').eq('id', sel.id).eq('tenant_id', tenantId).maybeSingle();
      entity = data;
      if (entity) docs = await projectDocImages(db, tenantId, sel.id);
    } else {
      const { data } = await db.from('custom_references').select('*').eq('id', sel.id).eq('tenant_id', tenantId).maybeSingle();
      entity = data;
      if (entity) docs = await customDocImages(db, tenantId, sel.id);
    }
    if (!entity) { warnings.push(`Référence introuvable : ${sel.source}:${sel.id}`); continue; }

    const isProject = sel.source === 'project';
    const placeText = isProject ? (entity.cp_ville_terrain || entity.address) : entity.location;
    const derived = deriveCityDept(placeText);
    const cotraitants = isProject ? await projectCotraitantNames(db, tenantId, sel.id) : [];
    const defaultMoe = agency.manager
      ? `${agency.manager}, Architecte ${agency.acronym}${cotraitants.length ? ` — avec ${cotraitants.join(', ')}` : ''}`
      : null;
    const mission = cleanText(sheet?.mission) ?? (isProject ? await projectMission(db, tenantId, sel.id) : null);
    const cost = parseAmount(entity.construction_cost);

    // Images : choix explicite, sinon celles enregistrées sur la fiche, sinon la couverture.
    let wanted = sel.imageIds && sel.imageIds.length
      ? sel.imageIds
      : (Array.isArray(sheet?.images) && sheet!.images!.length ? sheet!.images!.map(i => i.id) : ['cover']);
    if (sel.primaryImageId && wanted.includes(sel.primaryImageId)) {
      wanted = [sel.primaryImageId, ...wanted.filter(i => i !== sel.primaryImageId)];
    }
    const images: SheetImage[] = [];
    for (const candidateId of sel.skipImages ? [] : [...new Set(wanted)].slice(0, MAX_IMAGES)) {
      const img = await loadCandidate(db, tenantId, sel.source, entity, candidateId, docs);
      if (img) images.push(img);
      else if (candidateId !== 'cover') warnings.push(`Image ignorée pour « ${entity.name} » : ${candidateId} n’appartient pas à cette référence ou est illisible.`);
    }

    const name = cleanText(entity.name) ?? 'Sans titre';
    references.push({
      key: `${sel.source}:${sel.id}`,
      name,
      nature: cleanText(sheet?.nature)
        ?? (isProject ? cleanText(entity.type_projet) ?? cleanText(entity.categorie_projet) ?? cleanText(entity.category) : cleanText(entity.category)),
      city: cleanText(sheet?.city) ?? derived.city,
      department: cleanText(sheet?.department) ?? derived.department,
      programme: cleanText(sel.programOverride) ?? cleanText(isProject ? entity.programme : entity.description),
      labels: cleanText(sheet?.labels),
      maitreOuvrage: cleanText(entity.client),
      maitreOeuvre: cleanText(sheet?.maitre_oeuvre) ?? defaultMoe,
      mission,
      phase: cleanText(sheet?.phase),
      surface: (isProject ? parseAmount(entity.surface_plancher) : null) ?? parseAmount(entity.surface),
      amountText: cleanText(sheet?.amount_text),
      amount: cost,
      year: yearOf(entity.end_date, entity.start_date),
      images,
    });
  }
  return { references, warnings };
}
