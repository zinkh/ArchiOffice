import { describe, expect, it } from 'vitest';
import { SITE_PHOTO_KEEP_BELOW_BYTES, isAlreadyLight, jpegName, prepareSitePhoto } from '../sitePhoto';

describe('isAlreadyLight', () => {
  it('laisse partir un JPEG léger tel quel', () => {
    expect(isAlreadyLight({ type: 'image/jpeg', size: SITE_PHOTO_KEEP_BELOW_BYTES })).toBe(true);
  });

  it("réduit un JPEG lourd (photo d'iPad)", () => {
    expect(isAlreadyLight({ type: 'image/jpeg', size: 5 * 1024 * 1024 })).toBe(false);
  });

  it('réduit toujours un PNG ou un HEIC, quelle que soit sa taille', () => {
    expect(isAlreadyLight({ type: 'image/png', size: 10 })).toBe(false);
    expect(isAlreadyLight({ type: 'image/heic', size: 10 })).toBe(false);
  });
});

describe('jpegName', () => {
  it("garde le nom de base et passe l'extension en .jpg", () => {
    expect(jpegName('IMG_0042.HEIC')).toBe('IMG_0042.jpg');
    expect(jpegName('plan.final.png')).toBe('plan.final.jpg');
  });

  it('donne un nom quand il manque', () => {
    expect(jpegName(undefined)).toBe('photo.jpg');
    expect(jpegName('')).toBe('photo.jpg');
    expect(jpegName('.jpg')).toBe('photo.jpg');
  });
});

describe('prepareSitePhoto', () => {
  it("ne lève jamais et renvoie la photo d'origine quand le navigateur ne peut pas la réduire", async () => {
    // Environnement Node : pas de canvas, la photo doit repartir intacte plutôt que de bloquer la saisie.
    const file = new File([new Uint8Array(2 * 1024 * 1024)], 'IMG_1.jpg', { type: 'image/jpeg' });
    await expect(prepareSitePhoto(file)).resolves.toBe(file);
  });

  it("laisse passer un fichier qui n'est pas une image", async () => {
    const file = new File(['x'], 'note.txt', { type: 'text/plain' });
    await expect(prepareSitePhoto(file)).resolves.toBe(file);
  });
});
