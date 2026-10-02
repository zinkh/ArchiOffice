# 005 : Unifier le retour à l'appui sur celui des boutons `.btn`

- **Statut** : DONE
- **Commit** : bedc65f
- **Gravité** : MOYENNE
- **Catégorie** : Physique, accessibilité
- **Périmètre estimé** : 1 fichier CSS + 5 fichiers de composants, 11 boutons

## Problème

L'application a un retour à l'appui de référence, défini dans `src/index.css`
(bloc `@layer components`, ligne 80) :

```css
/* src/index.css:151 (actuel) */
transition: background 0.12s, filter 0.12s, transform 0.16s ease-out;
/* src/index.css:158 (actuel) */
.btn:active:not(:disabled) {
  transform: scale(0.97);
  filter: brightness(0.94);
  transition-duration: 0.05s;
}
/* src/index.css:509 (actuel) */
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto !important; }
  .animate-pulse { animation: none !important; }
  .btn:active:not(:disabled) { transform: none; }
}
```

L'enfoncement est immédiat (50 ms), le retour se fait en 160 ms, et
« Réduire les animations » le neutralise. Onze boutons ont un second système,
écrit à la main :

```tsx
// src/pages/Invoices.tsx:667 (actuel), même forme en :676, src/pages/Proposals.tsx:487, :1281, :1289
className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold transition-all active:scale-95 disabled:opacity-60"
// src/components/InvoiceGenerator.tsx:276 (actuel), même forme en :288
className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-bold shadow-lg shadow-blue-500/20 transition-all active:scale-95"
// src/components/dashboard/DashboardWidgets.tsx:48 (actuel)
className="rounded-xl p-4 flex flex-col gap-2 cursor-pointer transition-all active:scale-[0.98] relative overflow-hidden"
// src/components/dashboard/DashboardWidgets.tsx:143 (actuel)
className="flex flex-col items-center gap-2 p-3 rounded-xl transition-all active:scale-95 flex-1"
```

```tsx
// src/components/TenderRssWatch.tsx:399 (actuel), même forme en :975
<motion.button
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.98 }}
```

Défauts :
- `scale-95` est un enfoncement trop marqué (cible : 0,97) ;
- l'enfoncement et le relâché ont la même durée (150 ms, symétrique), alors que
  l'appui doit répondre immédiatement ;
- aucune de ces règles n'est neutralisée par « Réduire les animations » ;
- `transition-all` anime aussi toute propriété de mise en page ;
- `whileHover={{ scale: 1.02 }}` est le seul survol avec zoom de l'application,
  contraire à la sobriété Tabler.

## Cible

Une classe utilitaire `.press`, qui reproduit exactement le retour de `.btn`
pour les éléments qui ne peuvent pas prendre la classe `.btn` (padding, taille
de police et couleurs propres), avec la courbe de sortie forte de
l'application :

```css
/* src/index.css, dans @layer components, juste après la règle .btn:active */
.press {
  transition: background-color 0.12s, color 0.12s, border-color 0.12s,
              box-shadow 0.12s, filter 0.12s, opacity 0.12s,
              transform 0.16s var(--ease-out);
  -webkit-tap-highlight-color: transparent;
}
.press:active:not(:disabled) {
  transform: scale(0.97);
  transition-duration: 0.05s;
}
```

```css
/* src/index.css, bloc :root */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
```

```css
/* src/index.css:509, bloc prefers-reduced-motion, ajout */
.press:active:not(:disabled) { transform: none; }
```

Sur les 11 éléments : `transition-all` et `active:scale-95` /
`active:scale-[0.98]` sont retirés et remplacés par `press`. Les deux
`motion.button` de `TenderRssWatch.tsx` deviennent des `<button>` avec `press`,
sans `whileHover`.

## Conventions du dépôt à suivre

- Les règles de composants vivent dans `@layer components` de `src/index.css`
  (ligne 80 à 205) ; `.btn` et `.btn:active` (lignes 140-162) sont
  l'exemplaire à imiter.
- La couche `components` est plus faible que les utilitaires Tailwind : c'est
  pourquoi il faut RETIRER `transition-all` de ces éléments (sinon il
  écraserait `.press`) ; les utilitaires de couleur comme `hover:bg-blue-700`
  continuent de fonctionner.
- Le bloc « Réduire les animations » (`src/index.css:509`) retire le
  déplacement mais garde les changements d'état : même traitement pour `.press`.

## Étapes

1. `src/index.css`, bloc `:root` (ligne 9) : ajouter
   `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);` s'il n'existe pas déjà (le
   plan 001 ajoute le même jeton : ne pas le dupliquer).
2. `src/index.css`, dans `@layer components`, juste après la règle
   `.btn:active:not(:disabled) { ... }` (se termine ligne 162) : ajouter les
   deux règles `.press` et `.press:active:not(:disabled)` de la section Cible.
3. `src/index.css:509`, bloc `@media (prefers-reduced-motion: reduce)` :
   ajouter la ligne `.press:active:not(:disabled) { transform: none; }` après
   celle de `.btn`.
4. Dans chacune de ces 9 chaînes `className`, retirer `transition-all` et le
   jeton `active:scale-95` (ou `active:scale-[0.98]`), et ajouter `press` :
   - `src/pages/Invoices.tsx:667`
   - `src/pages/Invoices.tsx:676`
   - `src/pages/Proposals.tsx:487`
   - `src/pages/Proposals.tsx:1281`
   - `src/pages/Proposals.tsx:1289`
   - `src/components/InvoiceGenerator.tsx:276`
   - `src/components/InvoiceGenerator.tsx:288`
   - `src/components/dashboard/DashboardWidgets.tsx:48`
   - `src/components/dashboard/DashboardWidgets.tsx:143`

   Exemple : `"flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold transition-all active:scale-95"`
   devient `"flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold press"`.
5. `src/components/TenderRssWatch.tsx:399-401` et `:975-977` : remplacer
   `<motion.button` par `<button`, supprimer les lignes
   `whileHover={{ scale: 1.02 }}` et `whileTap={{ scale: 0.98 }}`, ajouter
   `press` au `className`, et remplacer la balise fermante `</motion.button>`
   correspondante par `</button>`. Garder l'import de `motion` : il sert encore
   à la modale ligne 694.

## Limites

- Ne pas convertir ces éléments en `.btn` : leur padding, leur taille de texte
  et leurs couleurs doivent rester identiques.
- Ne modifier ni `.btn` ni ses variantes.
- Ne toucher à aucun autre `active:scale-*` ou `whileTap` que ceux listés.
- Ne pas ajouter de dépendance.
- Si un extrait cité ne correspond plus au code (dérive depuis bedc65f),
  S'ARRÊTER et le signaler.

## Vérification

- **Mécanique** : `npm run lint`, `npm test`, `npm run build` passent ;
  `grep -rn "active:scale-95\|active:scale-\[0.98\]" src` ne renvoie plus
  aucune des 9 lignes listées ; `grep -n "whileHover" src/components/TenderRssWatch.tsx`
  ne renvoie rien.
- **Ressenti** :
  - Sur `/invoices`, maintenir le clic sur « Nouvelle facture » : le bouton
    s'enfonce aussitôt, légèrement (moins qu'avant), puis revient en douceur au
    relâché. Comparer avec un bouton `.btn` voisin : le geste doit être
    identique.
  - Sur téléphone (ou émulation tactile), toucher une tuile du tableau de bord :
    même enfoncement, sans voile gris de toucher.
  - Sur la veille des appels d'offres, survoler « Ajouter une source » : plus
    aucun zoom, seul l'appui enfonce le bouton.
  - DevTools, vitesse 10 % : l'enfoncement est nettement plus court que le
    retour (asymétrie voulue).
  - Émuler `prefers-reduced-motion: reduce` : plus aucun enfoncement, les
    changements de couleur au survol restent.
- **Terminé quand** : les 11 éléments utilisent `press`, la classe est
  couverte par le bloc « Réduire les animations », et les trois commandes
  passent.
