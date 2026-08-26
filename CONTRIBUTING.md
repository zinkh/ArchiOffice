# Contribuer à ArchiOffice

## Avant de commencer

- Node.js 22+, `npm install` (le dépôt utilise `--legacy-peer-deps`, voir `.npmrc`).
- Copier `.env.example` vers `.env` et renseigner au minimum `GEMINI_API_KEY`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`.
- `npm run dev` démarre le serveur (API + Vite en HMR).

## Workflow

1. Une branche par sujet, à partir de `main` (`git checkout -b <sujet>`).
2. Développer, en gardant les commits ciblés et le message au présent de
   l'impératif (`Fix …`, `Add …`, `Stop …` — voir l'historique `git log`
   pour le ton attendu).
3. Avant de pousser, faire tourner localement ce que la CI (`.github/workflows/ci.yml`)
   vérifie :
   ```bash
   npm run lint   # tsc --noEmit
   npm test       # vitest run
   npm run build
   npm audit --audit-level=critical
   ```
4. Ouvrir une Pull Request vers `main`. La CI doit être verte.
5. **Revue obligatoire avant fusion** — voir `CODEOWNERS`. Une PR qui touche
   au schéma Supabase (`supabase/`), à l'authentification, au chiffrement
   (`server/secretsCrypto.ts`, `server/ipcCrypto.ts`), à l'isolation
   multi-tenant (`server/tenantScopedFrom.ts`) ou aux outils de l'agent IA
   (`packages/archioffice-agents/src/server/tools.ts`) ne se fusionne pas
   sans une revue explicite de ces changements précis, même quand la CI
   est verte : ce sont exactement les surfaces où un bug est un incident
   de sécurité, pas juste une régression.

## Style de code

Pas d'ESLint ni de Prettier configurés — rester cohérent avec le style
environnant (voir `CLAUDE.md` à la racine pour les conventions du projet :
alias `@/*`, i18next pour tout texte UI, Tailwind pour le style, etc.).

## Tests

`tests/*.test.ts` (Vitest + Supertest, `FakeSupabaseAdmin` en mémoire — voir
`tests/testServer.ts`). Toute correction de bug de sécurité (isolation
tenant, RBAC, validation d'entrée) doit venir avec un test qui échoue avant
le correctif et passe après, sur le modèle de `tests/tenantIsolation.test.ts`
et `tests/rbac.test.ts`.

## Signaler un problème de sécurité

Ne pas ouvrir d'issue publique pour une vulnérabilité — voir `SECURITY.md`.
