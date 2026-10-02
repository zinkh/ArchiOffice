// L'adaptateur Dropbox (server/externalStorage/providers/dropbox.ts).
//
// Un seul comportement mérite vraiment un test unitaire ici, mais il le mérite
// beaucoup : l'échappement de l'en-tête Dropbox-API-Arg. Un en-tête HTTP ne
// porte que de l'ASCII, et cet en-tête contient le chemin du fichier, donc le
// nom de l'affaire. Avec des noms français, l'oublier casse au premier dépôt.
import { describe, expect, it } from 'vitest';
import { DROPBOX_SCOPE, toAsciiJsonHeader } from '../server/externalStorage/providers/dropbox';

const isPureAscii = (s: string) => /^[\x00-\x7f]*$/.test(s);

describe('toAsciiJsonHeader', () => {
  it('échappe les accents d’un nom d’affaire français', () => {
    const header = toAsciiJsonHeader({ path: '/ArchiOffice/26014 - Réhabilitation Château/DCE/plan.pdf' });
    expect(isPureAscii(header)).toBe(true);
    // Et reste relisible tel quel par le décodeur JSON de Dropbox.
    expect(JSON.parse(header).path).toBe('/ArchiOffice/26014 - Réhabilitation Château/DCE/plan.pdf');
  });

  it('échappe aussi les caractères hors du plan latin', () => {
    const header = toAsciiJsonHeader({ path: '/œuvre/日本語/📐.pdf' });
    expect(isPureAscii(header)).toBe(true);
    expect(JSON.parse(header).path).toBe('/œuvre/日本語/📐.pdf');
  });

  it('laisse un chemin déjà ASCII inchangé', () => {
    const header = toAsciiJsonHeader({ path: '/ArchiOffice/26014 - Villa Martin/DCE/cctp.pdf' });
    expect(header).toBe('{"path":"/ArchiOffice/26014 - Villa Martin/DCE/cctp.pdf"}');
  });

  it('préserve les autres champs de l’argument', () => {
    const parsed = JSON.parse(toAsciiJsonHeader({ path: '/é', mode: 'add', autorename: true, mute: true }));
    expect(parsed).toEqual({ path: '/é', mode: 'add', autorename: true, mute: true });
  });
});

describe('scopes', () => {
  it('demande la lecture, l’écriture et les métadonnées, rien de plus', () => {
    expect(DROPBOX_SCOPE.split(' ').sort()).toEqual([
      'account_info.read', 'files.content.read', 'files.content.write', 'files.metadata.read',
    ]);
  });
});
