import { describe, expect, it } from 'vitest';
import { CAD_EXTENSIONS, fileExtension, isCadFileName, isIgnoredFileName } from '../cadFiles';

describe('fileExtension', () => {
  it('rend l\'extension en minuscules sans point', () => {
    expect(fileExtension('Plan RDC.DWG')).toBe('dwg');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
  });
  it('rend une chaîne vide sans extension', () => {
    expect(fileExtension('Makefile')).toBe('');
    expect(fileExtension('.gitignore')).toBe('');
    expect(fileExtension('fin.')).toBe('');
    expect(fileExtension(null)).toBe('');
  });
});

describe('isCadFileName', () => {
  it.each(['a.dwg', 'A.DXF', 'maison.rvt', 'famille.rfa', 'maquette.ifc', 'vue.skp', 'projet.pln', 'site.dgn', 'plan.vwx', 'forme.3dm'])(
    'reconnaît %s comme un fichier CAO',
    name => expect(isCadFileName(name)).toBe(true),
  );
  it.each(['note.pdf', 'devis.xlsx', 'photo.jpg', 'cctp.docx', 'dwg', 'dwg.txt'])(
    'ne prend pas %s pour un fichier CAO',
    name => expect(isCadFileName(name)).toBe(false),
  );
  it('ne contient que des extensions en minuscules et sans point', () => {
    for (const ext of CAD_EXTENSIONS) expect(ext).toMatch(/^[a-z0-9]+$/);
    expect(new Set(CAD_EXTENSIONS).size).toBe(CAD_EXTENSIONS.length);
  });
});

describe('isIgnoredFileName', () => {
  it.each(['~$Plan.docx', 'Thumbs.db', '.DS_Store', 'desktop.ini', '._Plan.pdf', 'brouillon.tmp', 'plan.bak', 'plan.dwl', 'plan.dwl2', 'gros.part'])(
    'ignore %s',
    name => expect(isIgnoredFileName(name)).toBe(true),
  );
  it.each(['Plan.pdf', 'tmp.pdf', 'sauvegarde.docx', 'notes~.txt', ''])(
    'garde %s',
    name => expect(isIgnoredFileName(name)).toBe(false),
  );
});
