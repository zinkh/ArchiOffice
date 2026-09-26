# 003 : Ne plus animer la largeur du champ de recherche globale

- **Statut** : TODO
- **Commit** : bedc65f
- **Gravité** : MOYENNE
- **Catégorie** : Fréquence, performance
- **Périmètre estimé** : 1 fichier, 1 ligne

## Problème

Le champ de recherche globale de l'en-tête est l'entrée la plus fréquente de
l'application : on y arrive au clavier par Ctrl+K / Cmd+K
(`src/App.tsx:273`) des dizaines de fois par jour. À chaque prise de focus, il
anime sa largeur de `w-52` à `w-72` :

```tsx
// src/App.tsx:384 (actuel)
className="pl-8 pr-3 py-1.5 w-52 outline-none transition-[width,border-color,box-shadow] focus:w-72 focus:border-[var(--tblr-primary)] focus:shadow-[0_0_0_3px_var(--tblr-primary-lt)]"
```

Deux défauts :
1. Un geste clavier très fréquent ne doit pas être animé : la frappe commence
   pendant que le champ est encore en train de s'élargir, et le texte saisi
   glisse sous le curseur.
2. `width` est une propriété de mise en page : chaque image de la transition
   recalcule toute la barre d'en-tête.

## Cible

L'élargissement devient instantané ; la bordure et le halo de focus restent
animés (ce sont des retours d'état, pas des déplacements) :

```tsx
// cible
className="pl-8 pr-3 py-1.5 w-52 outline-none transition-[border-color,box-shadow] focus:w-72 focus:border-[var(--tblr-primary)] focus:shadow-[0_0_0_3px_var(--tblr-primary-lt)]"
```

## Conventions du dépôt à suivre

- Tailwind 4, transitions ciblées par liste arbitraire
  (`transition-[border-color,box-shadow]`), comme déjà écrit sur cette même ligne.
- Règle de l'application : un geste répété des dizaines de fois par jour n'est
  pas animé (voir la liste de résultats de recherche, `src/App.tsx:395`, qui
  s'affiche sans animation, à juste titre).

## Étapes

1. `src/App.tsx:384` : dans la chaîne `className`, remplacer
   `transition-[width,border-color,box-shadow]` par
   `transition-[border-color,box-shadow]`. Rien d'autre.

## Limites

- Ne pas retirer `focus:w-72` : l'élargissement reste, il devient seulement
  immédiat.
- Ne pas animer la liste de résultats (`src/App.tsx:395`).
- Ne toucher à aucune autre ligne.
- Si la ligne 384 ne correspond plus à l'extrait (dérive depuis bedc65f),
  S'ARRÊTER et le signaler.

## Vérification

- **Mécanique** : `npm run lint` et `npm run build` passent.
- **Ressenti** :
  - Sur un écran de bureau, appuyer sur Ctrl+K : le champ est immédiatement à
    sa largeur finale, et la première lettre tapée apparaît sans que le texte
    ne se déplace.
  - Cliquer dans le champ puis en dehors : bordure et halo bleu apparaissent et
    disparaissent en douceur (environ 150 ms), la largeur change d'un coup.
  - DevTools, onglet Performance, enregistrer une prise de focus : un seul
    « Layout », pas un par image.
- **Terminé quand** : `width` ne figure plus dans la liste de transition de
  `src/App.tsx:384`.
