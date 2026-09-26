# 001 : Remplacer `transition-all` par des transitions ciblées

- **Statut** : DONE
- **Commit** : bedc65f
- **Gravité** : HAUTE
- **Catégorie** : Performance
- **Périmètre estimé** : 30 fichiers, 118 remplacements mécaniques + 5 barres de progression

## Problème

`transition-all` apparaît 127 fois dans `src/` et `packages/archioffice-agents/src/`
(38 dans `src/pages/ProjectDetail.tsx`, 16 dans `src/components/ACTModule.tsx`,
9 dans `src/components/ChantierModule.tsx`, 8 dans `src/pages/Invoices.tsx`...).
Il anime toutes les propriétés qui changent, y compris celles qui imposent un
recalcul de mise en page à chaque image (`width`, `left`, `height`, `padding`).
Cinq éléments animent réellement leur largeur à cause de lui :

```tsx
// src/pages/CloudImportProgress.tsx:228 (actuel, avancement d'un import, mis à jour en continu)
<div className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden mb-3">
  <div
    className="h-full bg-blue-600 transition-all duration-300"
    style={{ width: `${percent}%` }}
  />
</div>
```

```tsx
// src/pages/Gantt.tsx:372 (actuel, remplissage d'avancement d'une barre de tâche)
<div 
  className="absolute left-0 top-0 bottom-0 bg-purple-500 dark:bg-purple-600 transition-all duration-300"
  style={{ width: `${task.progress}%` }}
/>
```

```tsx
// src/components/MilestoneGantt.tsx:138 (actuel, barre de jalon positionnée en left/width)
<div 
  className={cn(
    "absolute top-0 h-full flex items-center px-2 text-[0.6875rem] text-white font-bold transition-all rounded-full shadow-sm",
    milestone.completed ? "bg-green-500" : "bg-blue-500"
  )}
  style={{ left: `${Math.max(0, startOffset)}%`, width: `${Math.max(width, 2)}%` }}
>
```

```tsx
// src/components/tasks/TaskCard.tsx:67 (actuel)
<div
  className="h-full rounded-full transition-all"
  style={{ width: `${task.progress || 0}%`, background: isDone ? 'var(--tblr-success)' : 'var(--tblr-primary)' }}
/>
```

```tsx
// src/pages/Billing.tsx:67 (actuel)
<div
  className={cn(
    'h-full rounded-full transition-all',
    isFull ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-blue-500'
  )}
  style={{ width: `${pct}%` }}
/>
```

Les 118 autres usages sont des boutons, champs, lignes et cartes dont seules
les couleurs, l'opacité, l'ombre ou la transformation changent : `transition-all`
n'y apporte rien d'autre qu'un risque (la prochaine modification de `padding`
ou de `width` au survol serait animée hors GPU sans que personne ne le décide).

## Cible

1. **Règle générale** : `transition-all` devient `transition` (en conservant
   tout préfixe de variante : `after:transition-all` devient `after:transition`).
   Dans Tailwind 4, `transition` anime exactement `color, background-color,
   border-color, outline-color, text-decoration-color, fill, stroke,
   --tw-gradient-from, --tw-gradient-via, --tw-gradient-to, opacity, box-shadow,
   transform, translate, scale, rotate, filter, backdrop-filter, display,
   visibility, content-visibility, overlay, pointer-events`, avec la même durée
   (150 ms) et la même courbe par défaut que `transition-all`. Rien de visible ne
   change, sauf que les propriétés de mise en page ne sont plus jamais animées.

2. **Barres qui se remplissent en continu** (`CloudImportProgress.tsx`,
   `Gantt.tsx`) : largeur fixe à 100 %, avancement porté par `transform: scaleX()`
   depuis la gauche, avec la courbe forte de sortie du dépôt :

   ```tsx
   // cible
   <div
     className="h-full w-full bg-blue-600 origin-left transition-transform duration-300 ease-[var(--ease-out)]"
     style={{ transform: `scaleX(${percent / 100})` }}
   />
   ```

3. **Barres arrondies ou porteuses de texte** (`MilestoneGantt.tsx`,
   `TaskCard.tsx`, `Billing.tsx`) : un `scaleX` écraserait leurs extrémités
   arrondies ou le libellé du jalon, et leur valeur ne change qu'au chargement
   des données. On n'y anime donc plus la géométrie, seulement la couleur :
   `transition-all` devient `transition-colors`.

4. **Jeton de courbe** dans `:root` de `src/index.css` :
   `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);`

## Conventions du dépôt à suivre

- Les variables globales vivent dans le bloc `:root` en tête de `src/index.css`
  (ligne 9), au format `--nom:   valeur;` aligné.
- La courbe `cubic-bezier(0.23, 1, 0.32, 1)` est déjà la courbe de sortie de
  l'application : `src/components/ui/SwapText.tsx:21` l'écrit
  `ease: [0.23, 1, 0.32, 1]`.
- Tailwind 4 accepte une valeur arbitraire de courbe par variable :
  `ease-[var(--ease-out)]`.

## Étapes

1. Dans `src/index.css`, bloc `:root` (ligne 9), ajouter si elle n'existe pas
   déjà la ligne : `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);`
   (le plan 005 ajoute le même jeton : ne pas le dupliquer).
2. `src/pages/CloudImportProgress.tsx:229-230` : remplacer
   `className="h-full bg-blue-600 transition-all duration-300"` et
   `style={{ width: \`${percent}%\` }}` par
   `className="h-full w-full bg-blue-600 origin-left transition-transform duration-300 ease-[var(--ease-out)]"`
   et `style={{ transform: \`scaleX(${Math.min(100, Math.max(0, percent)) / 100})\` }}`.
3. `src/pages/Gantt.tsx:373-374` : remplacer
   `className="absolute left-0 top-0 bottom-0 bg-purple-500 dark:bg-purple-600 transition-all duration-300"`
   et `style={{ width: \`${task.progress}%\` }}` par
   `className="absolute inset-0 bg-purple-500 dark:bg-purple-600 origin-left transition-transform duration-300 ease-[var(--ease-out)]"`
   et `style={{ transform: \`scaleX(${Math.min(100, Math.max(0, task.progress || 0)) / 100})\` }}`.
4. `src/components/MilestoneGantt.tsx:139`, `src/components/tasks/TaskCard.tsx:68`,
   `src/pages/Billing.tsx:69` : remplacer `transition-all` par `transition-colors`.
   Ne pas toucher à leur `style`.
5. Ne PAS traiter dans ce plan les 9 lignes couvertes par le plan 005 (retour
   à l'appui) : `src/pages/Invoices.tsx:667`, `src/pages/Invoices.tsx:676`,
   `src/pages/Proposals.tsx:487`, `src/pages/Proposals.tsx:1281`,
   `src/pages/Proposals.tsx:1289`, `src/components/InvoiceGenerator.tsx:276`,
   `src/components/InvoiceGenerator.tsx:288`,
   `src/components/dashboard/DashboardWidgets.tsx:48`,
   `src/components/dashboard/DashboardWidgets.tsx:143`. Si le plan 005 a déjà
   été exécuté, elles ne contiennent plus `transition-all`.
6. Partout ailleurs dans `src/` et `packages/archioffice-agents/src/`, remplacer
   le jeton de classe `transition-all` par `transition`, en gardant le préfixe
   de variante éventuel. Remplacer le jeton entier uniquement (délimité par un
   espace, un guillemet ou un accent grave), jamais une sous-chaîne d'un autre
   mot. Exemple :
   `"w-full p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"`
   devient
   `"w-full p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition text-sm"`.
7. Vérifier qu'il ne reste plus rien :
   `grep -rn "transition-all" src packages/archioffice-agents/src` ne doit
   renvoyer que les lignes de l'étape 5 (ou rien si le plan 005 est fait).

## Limites

- Ne toucher à aucune autre classe que `transition-all`, sauf dans les
  étapes 2 et 3.
- Ne pas modifier le balisage, la structure ou la logique des composants.
- Ne pas modifier `src/index.css` au-delà de l'ajout du jeton.
- Ne pas ajouter de dépendance.
- Si un extrait cité ne correspond plus au code (dérive depuis le commit
  bedc65f), S'ARRÊTER et le signaler plutôt qu'improviser.

## Vérification

- **Mécanique** : `npm run lint` (aucune erreur TypeScript), `npm test`
  (suite Vitest verte), `npm run build` (réussit).
- **Ressenti** :
  - Lancer un import depuis l'espace cloud (écran `/cloud-import-progress`) : la barre
    progresse depuis la gauche, sans saccade, et ne dépasse jamais son cadre.
  - Dans `/gantt`, modifier l'avancement d'une tâche : le remplissage violet
    glisse depuis la gauche de la barre et s'arrête net, sans rebond.
  - DevTools, panneau Animations, vitesse 10 % : pendant la progression,
    l'onglet Performance ne montre aucun « Layout » à chaque image (seulement
    « Composite »).
  - Survoler une dizaine de boutons et champs modifiés (fiche projet, ACT,
    factures) : couleurs, halos de focus et ombres réagissent exactement comme
    avant.
  - Panneau Rendering, émuler `prefers-reduced-motion: reduce` : rien ne se
    déplace davantage qu'avant.
- **Terminé quand** : `transition-all` n'apparaît plus hors des 9 lignes du
  plan 005, les deux barres de l'étape 2 et 3 n'utilisent plus `width`, et les
  trois commandes passent.
