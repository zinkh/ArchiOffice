// Contrôle des OCTETS d'un fichier déposé sur le portail du DOE.
//
// Le nom et le type MIME envoyés par le navigateur ne valent rien : seul le
// contenu fait foi. Les formats bureautiques (PDF, Word, Excel, ODS, ODT) sont
// vérifiés par le contrôle du dépôt des offres (server/consultationDepot/
// fileRules.ts) ; ce module y ajoute les photos JPEG et PNG, fréquentes dans un
// DOE (ouvrages enterrés, étiquettes d'équipements), vérifiées à leur signature.
import { extensionDe } from '../../src/lib/consultationDepot';
import { DOE_FORMATS_LIBELLE, formatDoeAutorise } from '../../src/lib/doeAtelier';
import { verifierOctets } from '../consultationDepot/fileRules';

export type VerificationDoe = { ok: true; mime: string } | { ok: false; raison: string };

const refus = (nom: string, detail: string): VerificationDoe => ({ ok: false, raison: `« ${nom} » : ${detail}` });

const SIGNATURE_JPEG = [0xff, 0xd8, 0xff];
const SIGNATURE_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const commencePar = (buf: Buffer, signature: number[]): boolean =>
  buf.length >= signature.length && signature.every((octet, i) => buf[i] === octet);

export function verifierFichierDoe(nom: string, buf: Buffer): VerificationDoe {
  if (!formatDoeAutorise(nom)) return refus(nom, `format non accepté (${DOE_FORMATS_LIBELLE}).`);
  if (buf.length === 0) return refus(nom, 'le fichier est vide.');
  const ext = extensionDe(nom);
  if (ext === 'jpg' || ext === 'jpeg') {
    return commencePar(buf, SIGNATURE_JPEG) ? { ok: true, mime: 'image/jpeg' } : refus(nom, "ce n'est pas une image JPEG valide.");
  }
  if (ext === 'png') {
    return commencePar(buf, SIGNATURE_PNG) ? { ok: true, mime: 'image/png' } : refus(nom, "ce n'est pas une image PNG valide.");
  }
  return verifierOctets(nom, buf);
}
