// Résolution des données d'un panneau de chantier depuis l'affaire : maître
// d'ouvrage, AMO, maîtrise d'œuvre, intervenants, lots et entreprises, logos.
// Rien n'est ressaisi : tout vient de l'affaire et des fiches contact du
// cabinet, relues par identifiant. Une donnée absente reste vide.
import { Jimp } from 'jimp';
import { cleanText } from '../referencesDossier/format';
import { loadAgency, resolveReferences } from '../referencesDossier/data';
import { prepareLogo } from './logos';
import type { ChantierPanelData, PanelFact, PanelLogo, PanelLot, PanelParty } from './types';

type Db = any;

const AMO_ROLE = /\bamo\b|assistan\w* (?:à|a) maîtrise|assistan\w* (?:à|a) maitrise/i;

interface ContactRow {
  id: string; first_name?: string | null; last_name?: string | null; company_name?: string | null;
  address_work_street?: string | null; address_work_zip?: string | null; address_work_city?: string | null;
  address?: string | null; zip?: string | null; city?: string | null; logo?: string | null;
}

function contactName(c: ContactRow | undefined): string | null {
  if (!c) return null;
  return cleanText(c.company_name) ?? cleanText(`${c.first_name ?? ''} ${c.last_name ?? ''}`);
}

function contactAddress(c: ContactRow | undefined): string[] {
  if (!c) return [];
  const street = cleanText(c.address_work_street) ?? cleanText(c.address);
  const zip = cleanText(c.address_work_zip) ?? cleanText(c.zip);
  const city = cleanText(c.address_work_city) ?? cleanText(c.city);
  const line2 = [zip, city].filter(Boolean).join(' ');
  return [street, line2 || null].filter((x): x is string => !!x);
}

/** « 02 » et « 2 » désignent le même lot ; « 08.1 » et « 8.1 » aussi. */
export function normalizeLotNumber(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
}

export function compareLotNumbers(a: string, b: string): number {
  return a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });
}

function frDate(iso: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

async function safeSelect(db: Db, table: string, build: (q: any) => any): Promise<any[]> {
  try {
    const { data, error } = await build(db.from(table));
    return error ? [] : (data || []);
  } catch { return []; }
}

export interface ChantierLoadInput {
  imageId?: string | null;
  withImage?: boolean;
  /** Informations libres du panneau (début et durée des travaux...). */
  startDate?: string | null;
  durationText?: string | null;
}

export async function loadChantierPanel(
  db: Db, tenantId: string, projectId: string, input: ChantierLoadInput = {},
): Promise<ChantierPanelData | null> {
  const { data: project } = await db.from('projects').select('*').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
  if (!project) return null;
  const warnings: string[] = [];
  const agency = await loadAgency(db, tenantId);

  const [cotraitants, stakeholders, lotRows, marches, permits] = await Promise.all([
    safeSelect(db, 'project_cotraitants', q => q.select('id, specialty, contact_id').eq('tenant_id', tenantId).eq('project_id', projectId)),
    safeSelect(db, 'project_stakeholders', q => q.select('id, name, role, contact_id').eq('tenant_id', tenantId).eq('project_id', projectId)),
    safeSelect(db, 'project_lots', q => q.select('id, lot_number, lot_title, contact_id').eq('tenant_id', tenantId).eq('project_id', projectId)),
    safeSelect(db, 'marches_entreprises', q => q.select('*').eq('tenant_id', tenantId).eq('project_id', projectId)),
    safeSelect(db, 'permits', q => q.select('*').eq('tenant_id', tenantId).eq('project_id', projectId)),
  ]);

  const usableMarches = marches.filter(m => m.type_marche !== 'subsequent' && m.statut !== 'resilie');
  const ids = new Set<string>();
  const add = (id: unknown) => { if (typeof id === 'string' && id) ids.add(id); };
  add(project.client_id);
  cotraitants.forEach(c => add(c.contact_id));
  stakeholders.forEach(s => add(s.contact_id));
  lotRows.forEach(l => add(l.contact_id));
  usableMarches.forEach(m => add(m.contact_id));
  const contacts = new Map<string, ContactRow>();
  if (ids.size) {
    const rows = await safeSelect(db, 'contacts', q => q
      .select('id, first_name, last_name, company_name, address_work_street, address_work_zip, address_work_city, address, zip, city, logo')
      .eq('tenant_id', tenantId).in('id', [...ids]));
    rows.forEach((r: ContactRow) => contacts.set(r.id, r));
  }

  const logoFor = async (label: string, contactId: string | null | undefined): Promise<PanelLogo | null> => {
    const c = contactId ? contacts.get(contactId) : undefined;
    if (!c?.logo) return null;
    const res = await prepareLogo(c.logo);
    if (res.logo) return res.logo;
    if (res.reason !== 'absent') warnings.push(`Logo ignoré pour « ${label} » : ${res.reason}.`);
    return null;
  };

  const party = async (key: string, role: string, name: string, address: string[], contactId: string | null): Promise<PanelParty> =>
    ({ key, role, name, address, logo: await logoFor(name, contactId), contactId });

  // Maître d'ouvrage : fiche du client, à défaut les champs de l'affaire.
  const clientContact = project.client_id ? contacts.get(project.client_id) : undefined;
  const clientName = contactName(clientContact) ?? cleanText(project.is_entreprise ? project.nom_societe : null) ?? cleanText(project.client);
  const clientAddress = contactAddress(clientContact).length
    ? contactAddress(clientContact)
    : [cleanText(project.adresse_client), [cleanText(project.cp_client), cleanText(project.ville_client)].filter(Boolean).join(' ') || null].filter((x): x is string => !!x);
  const maitriseOuvrage: PanelParty[] = [];
  if (clientName) maitriseOuvrage.push(await party('moa', 'Maître d’ouvrage', clientName, clientAddress, project.client_id ?? null));

  const maitriseOeuvre: PanelParty[] = [];
  const amoRows = stakeholders.filter(s => AMO_ROLE.test(String(s.role ?? '')));
  for (const s of amoRows) {
    const c = s.contact_id ? contacts.get(s.contact_id) : undefined;
    const name = cleanText(s.name) ?? contactName(c);
    if (name) maitriseOuvrage.push(await party(`amo:${s.id}`, 'AMO', name, contactAddress(c), s.contact_id ?? null));
  }

  const agencyLogo = agency.logoDataUrl ? await prepareLogo(agency.logoDataUrl) : { logo: null };
  maitriseOeuvre.push({
    key: 'moe', role: 'Architecte', name: agency.name,
    address: agency.address ? [agency.address] : [], logo: agencyLogo.logo, contactId: null,
  });
  for (const c of cotraitants) {
    const contact = c.contact_id ? contacts.get(c.contact_id) : undefined;
    const name = contactName(contact);
    if (!name) { if (c.contact_id) warnings.push(`Cotraitant « ${cleanText(c.specialty) ?? c.id} » : fiche contact introuvable, ignoré.`); continue; }
    maitriseOeuvre.push(await party(`cot:${c.id}`, cleanText(c.specialty) ?? 'Cotraitant', name, contactAddress(contact), c.contact_id));
  }
  for (const s of stakeholders.filter(x => !AMO_ROLE.test(String(x.role ?? '')))) {
    const c = s.contact_id ? contacts.get(s.contact_id) : undefined;
    const name = cleanText(s.name) ?? contactName(c);
    if (name) maitriseOeuvre.push(await party(`int:${s.id}`, cleanText(s.role) ?? 'Intervenant', name, contactAddress(c), s.contact_id ?? null));
  }

  // Lots : la liste des lots de l'affaire fait foi ; l'entreprise vient du marché, à défaut de la fiche du lot.
  const marcheByLot = new Map<string, any>();
  for (const m of usableMarches) {
    const k = normalizeLotNumber(m.lot_numero);
    if (k && !marcheByLot.has(k)) marcheByLot.set(k, m);
  }
  const lots: PanelLot[] = [];
  for (const l of [...lotRows].sort((a, b) => compareLotNumbers(String(a.lot_number), String(b.lot_number)))) {
    const marche = marcheByLot.get(normalizeLotNumber(l.lot_number));
    const contactId: string | null = marche?.contact_id ?? l.contact_id ?? null;
    const contact = contactId ? contacts.get(contactId) : undefined;
    const company = cleanText(marche?.entreprise_nom) ?? contactName(contact);
    lots.push({
      key: `lot:${l.id}`, number: String(l.lot_number), title: String(l.lot_title ?? ''),
      company, address: contactAddress(contact),
      logo: company ? await logoFor(company, contactId) : null, contactId,
    });
  }
  if (lots.length === 0) warnings.push('Aucun lot sur cette affaire : la liste des entreprises est vide.');

  // Mentions de l'opération : seulement ce qui est connu.
  const facts: PanelFact[] = [];
  const pc = permits.find(p => p.type === 'PC' && (p.status === 'accorde' || p.decision_date)) ?? permits.find(p => p.type === 'PC');
  if (pc) {
    const num = cleanText(pc.numero_decision) ?? cleanText(pc.reference);
    const date = frDate(pc.decision_date);
    if (num) facts.push({ label: 'Permis de construire', value: `n° ${num}${date ? ` du ${date}` : ''}` });
  }
  const terrain = [cleanText(project.adresse_terrain), cleanText(project.cp_ville_terrain)].filter(Boolean).join(', ') || cleanText(project.address);
  if (terrain) facts.push({ label: 'Adresse du chantier', value: terrain });
  const sp = cleanText(project.surface_plancher);
  if (sp) facts.push({ label: 'Surface de plancher', value: `${sp} m²` });
  const start = frDate(input.startDate);
  if (start) facts.push({ label: 'Début des travaux', value: start });
  const duration = cleanText(input.durationText);
  if (duration) facts.push({ label: 'Durée prévisionnelle', value: duration });

  let image: ChantierPanelData['image'] = null;
  if (input.withImage !== false) {
    const { references, warnings: imgWarnings } = await resolveReferences(db, tenantId, agency, [
      { source: 'project', id: projectId, imageIds: [input.imageId || 'cover'], primaryImageId: input.imageId || 'cover' },
    ]);
    warnings.push(...imgWarnings);
    const img = references[0]?.images[0];
    if (img) {
      let widthPx: number | null = null;
      try { widthPx = (await Jimp.read(Buffer.from(img.dataUrl.slice(img.dataUrl.indexOf(',') + 1), 'base64'))).bitmap.width; } catch { /* mesure facultative */ }
      image = { id: img.id, dataUrl: img.dataUrl, widthPx };
    }
  }

  return {
    agency,
    projectName: cleanText(project.name) ?? 'Opération',
    kicker: cleanText(project.type_projet) ?? 'Chantier',
    facts, image, maitriseOuvrage, maitriseOeuvre, lots, warnings,
  };
}
