# Plans d'amélioration des animations

Issus de l'audit des animations d'ArchiOffice au commit `bedc65f`. Chaque plan
est autonome : un agent sans contexte peut l'exécuter tel quel.

| # | Plan | Gravité | Statut |
|---|---|---|---|
| 001 | [Remplacer `transition-all` par des transitions ciblées](001-remplacer-transition-all.md) | HAUTE | DONE |
| 002 | [Sortie animée des 9 modales qui disparaissent d'un coup](002-sortie-des-modales.md) | MOYENNE | DONE |
| 003 | [Recherche globale sans animation de largeur](003-recherche-globale-sans-animation-de-largeur.md) | MOYENNE | DONE |
| 004 | [Panneau de chat des agents, agrandissement sans animation de mise en page](004-panneau-chat-agents.md) | MOYENNE | DONE |
| 005 | [Unifier le retour à l'appui sur celui des boutons `.btn`](005-retour-a-l-appui-unifie.md) | MOYENNE | DONE |

## Ordre d'exécution recommandé

1. **003** puis **004** : une ligne chacun, sans dépendance. Gains immédiats.
2. **005** : introduit la classe `.press` et le jeton `--ease-out`.
3. **001** : le plus volumineux (30 fichiers) ; il exclut explicitement les
   9 lignes traitées par 005 et réutilise `--ease-out`.
4. **002** : indépendant des autres, mais touche `Invoices.tsx`, `Contacts.tsx`
   et `Projects.tsx`, également modifiés par 001 : l'exécuter après 001 évite
   les conflits de fusion.

## Dépendances

- 001 et 005 ajoutent tous deux `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);`
  dans `:root` de `src/index.css` : le second à passer vérifie qu'il existe
  déjà et ne le duplique pas.
- 001 laisse volontairement intactes les 9 lignes `transition-all active:scale-*`
  couvertes par 005.
- Aucun plan ne nécessite de migration SQL ni de nouvelle dépendance.

## Constats non planifiés (basse gravité)

- Zoom de 500 ms sur l'image des cartes d'affaire (`src/pages/Projects.tsx:806`).
- Courbes et durées écrites à la main hors de `src/lib/motion.ts`
  (`SwapText.tsx:21`, `AdminDashboard.tsx:25`, `App.tsx:567`).
- Points de saisie en `animate-bounce` du chat non couverts par
  « Réduire les animations » (`AgentChat.tsx:854`, `AgentChatPage.tsx:380`).
- Opportunités : fondu du voile sur les autres modales, fondu croisé d'un toast
  remplacé (`src/components/ui/Toast.tsx`).
