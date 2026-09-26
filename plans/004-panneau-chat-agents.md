# 004 : Panneau de chat des agents, agrandissement sans animation de mise en page

- **Statut** : TODO
- **Commit** : bedc65f
- **Gravité** : MOYENNE
- **Catégorie** : Performance
- **Périmètre estimé** : 1 fichier, 1 bloc de props

## Problème

Le panneau flottant de chat des agents
(`packages/archioffice-agents/src/client/AgentChat.tsx:653-676`) a deux
défauts de mouvement :

```tsx
// packages/archioffice-agents/src/client/AgentChat.tsx:653 (actuel)
<motion.div
  initial={{ opacity: 0, x: 40 }}
  animate={{ opacity: 1, x: 0 }}
  exit={{ opacity: 0, x: 40 }}
  transition={{ duration: 0.2, ease: 'easeOut' }}
  className="fixed right-3 md:right-6 z-50 flex flex-col shadow-2xl rounded-xl overflow-hidden transition-[width,height] duration-200"
  style={expanded ? {
    ...
    width: 'min(900px, calc(100vw - 24px))',
    height: 'min(88vh, calc(100vh - 40px))',
    ...
  } : {
    ...
    width: 'min(420px, calc(100vw - 24px))',
    height: 'min(640px, calc(100vh - 100px))',
    ...
  }}
```

1. **Agrandir / réduire** (bouton `packages/archioffice-agents/src/client/AgentChat.tsx:734`,
   `setExpanded(e => !e)`) anime `width` et `height` pendant 200 ms. Le panneau
   contient tout l'historique de la conversation : chaque image remet en page
   tous les messages, le texte se recompose ligne après ligne pendant
   l'animation, et les images sautent sur un poste chargé.
2. **Ouverture / fermeture** : le raccourci `x` de Motion n'est pas accéléré
   par le GPU (il s'exécute sur le fil principal), et `ease: 'easeOut'` est la
   courbe de sortie faible intégrée, alors que l'application utilise
   `cubic-bezier(0.23, 1, 0.32, 1)` partout ailleurs.

## Cible

- Agrandir / réduire est instantané : aucune transition de `width`/`height`.
- Ouverture / fermeture en chaîne `transform` complète et courbe forte :

```tsx
// cible
<motion.div
  initial={{ opacity: 0, transform: 'translateX(40px)' }}
  animate={{ opacity: 1, transform: 'translateX(0px)' }}
  exit={{ opacity: 0, transform: 'translateX(40px)' }}
  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
  className="fixed right-3 md:right-6 z-50 flex flex-col shadow-2xl rounded-xl overflow-hidden"
  style={...inchangé}
```

## Conventions du dépôt à suivre

- Ce paquet n'importe rien de l'application hôte : ne pas importer
  `src/lib/motion.ts` depuis `packages/archioffice-agents`. Écrire la courbe en
  ligne.
- Exemplaire de la courbe en ligne : `src/components/ui/SwapText.tsx:21`
  (`transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}`).
- `MotionConfig reducedMotion="user"` (`src/main.tsx`) réduit automatiquement
  cette animation à un fondu quand « Réduire les animations » est actif ; rien
  à ajouter pour l'accessibilité.

## Étapes

1. `packages/archioffice-agents/src/client/AgentChat.tsx:654-656` : remplacer
   `initial={{ opacity: 0, x: 40 }}`, `animate={{ opacity: 1, x: 0 }}`,
   `exit={{ opacity: 0, x: 40 }}` par
   `initial={{ opacity: 0, transform: 'translateX(40px)' }}`,
   `animate={{ opacity: 1, transform: 'translateX(0px)' }}`,
   `exit={{ opacity: 0, transform: 'translateX(40px)' }}`.
2. Ligne 657 : remplacer `transition={{ duration: 0.2, ease: 'easeOut' }}` par
   `transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}`.
3. Ligne 658 : dans `className`, supprimer `transition-[width,height] duration-200`
   (et l'espace qui précède). La chaîne devient
   `"fixed right-3 md:right-6 z-50 flex flex-col shadow-2xl rounded-xl overflow-hidden"`.

## Limites

- Ne pas modifier `style` (largeurs, hauteurs, `bottom`) : le passage de `vh` à
  `dvh` sur ce panneau est un autre sujet, hors de ce plan.
- Ne pas toucher aux autres `motion.div` du fichier (messages, bandeaux,
  suggestions).
- Ne pas ajouter d'animation `layout` : l'agrandissement instantané est la
  cible voulue.
- Si un extrait cité ne correspond plus au code (dérive depuis bedc65f),
  S'ARRÊTER et le signaler.

## Vérification

- **Mécanique** : `npm run lint`, `npm test`, `npm run build` passent.
- **Ressenti** :
  - Ouvrir le chat d'un agent avec une longue conversation, puis cliquer sur
    « Agrandir » : le panneau passe à sa grande taille en une image, le texte
    ne se recompose pas sous les yeux.
  - Ouvrir et fermer le panneau : il glisse de 40 px depuis la droite avec un
    départ vif et un arrêt doux ; cliquer deux fois très vite sur le bouton
    d'ouverture fait repartir le panneau de sa position courante, sans saut.
  - DevTools, vitesse 10 % : pendant l'ouverture, l'onglet Performance ne
    montre que du « Composite », pas de « Layout ».
  - Émuler `prefers-reduced-motion: reduce` : seule l'opacité s'anime.
- **Terminé quand** : plus de `transition-[width,height]` ni de raccourci `x`
  sur ce panneau, et les trois commandes passent.
