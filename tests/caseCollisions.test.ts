// Garde-fou Windows et macOS : leurs systèmes de fichiers ignorent la casse, pas Linux (la CI).
// Deux fichiers de code dont les noms ne diffèrent que par la casse (ProToolbar.tsx et
// proToolbar.ts) coexistent sous Linux, mais `./ProToolbar` résout alors vers le .ts sous
// Windows : le build du client de bureau de la v1.0.18 échouait en MISSING_EXPORT.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/;

/** Fichiers de code qui se heurteraient sur un disque insensible à la casse. */
export function findCaseCollisions(files: string[]): string[][] {
  const byStem = new Map<string, Set<string>>();
  for (const file of files) {
    const stem = file.replace(CODE_FILE, '').toLowerCase();
    const group = byStem.get(stem) ?? new Set<string>();
    group.add(file);
    byStem.set(stem, group);
  }
  const collisions: string[][] = [];
  for (const group of byStem.values()) {
    if (group.size < 2) continue;
    // Même nom exact avec deux extensions (foo.ts et foo.tsx) : un autre sujet, pas la casse.
    const stems = new Set([...group].map((file) => file.replace(CODE_FILE, '')));
    if (stems.size > 1) collisions.push([...group].sort());
  }
  return collisions;
}

describe('findCaseCollisions', () => {
  it('signale deux fichiers qui ne diffèrent que par la casse', () => {
    expect(findCaseCollisions(['src/ProToolbar.tsx', 'src/proToolbar.ts', 'src/autre.ts']))
      .toEqual([['src/ProToolbar.tsx', 'src/proToolbar.ts']]);
  });

  it('signale deux chemins identiques à la casse près', () => {
    expect(findCaseCollisions(['docs/A.ts', 'docs/a.ts'])).toEqual([['docs/A.ts', 'docs/a.ts']]);
  });

  it('ignore des fichiers distincts ou une simple différence d\'extension', () => {
    expect(findCaseCollisions(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/c.tsx'])).toEqual([]);
  });
});

describe('dépôt', () => {
  it('ne contient aucun fichier de code dont le nom ne diffère que par la casse', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0')
      .filter((file) => CODE_FILE.test(file));
    expect(findCaseCollisions(files)).toEqual([]);
  });
});
