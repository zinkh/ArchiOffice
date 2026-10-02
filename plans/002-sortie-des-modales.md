# 002 : Donner une sortie animée aux 9 modales qui disparaissent d'un coup

- **Statut** : DONE
- **Commit** : bedc65f
- **Gravité** : MOYENNE
- **Catégorie** : Interruption, cohérence
- **Périmètre estimé** : 4 composants + 8 fichiers de pages, environ 25 petites modifications

## Problème

La convention de l'application est qu'une modale naît de son déclencheur
(`launchOriginRef`) avec le ressort par défaut, et y retourne à la fermeture.
Neuf modales n'ont que la moitié du geste : elles entrent en ressort mais
disparaissent instantanément, car soit elles n'ont pas de prop `exit`, soit
leur montage conditionnel n'est enveloppé dans aucun `AnimatePresence`. Leur
voile (le fond noir semi-transparent) n'est jamais animé : il apparaît et
disparaît d'un bloc.

Les 9 modales concernées :

| # | Composant ou emplacement | Montée par |
|---|---|---|
| A | `src/components/CalendarEventModal.tsx:134` | `src/pages/Calendar.tsx:886` |
| B | `src/components/tasks/TaskFormModal.tsx:121` | `src/pages/Calendar.tsx:897`, `src/pages/Gantt.tsx:410`, `src/pages/Kanban.tsx:231`, `src/components/projectDetail/ProjectTasksTab.tsx:86`, `src/components/dashboard/MyTasksWidget.tsx:89` |
| C | `src/components/ContactModal.tsx:164` | le composant lui-même (`if (!isOpen) return null;`) |
| D | `src/components/InvoiceGenerator.tsx:244` | `src/pages/Invoices.tsx:1169` (déjà dans un `AnimatePresence`) |
| E, F, G | `src/pages/Contacts.tsx:914`, `:1026`, `:1081` | en ligne dans la page |
| H, I | `src/pages/Projects.tsx:1709`, `:1757` | en ligne dans la page |

Extrait représentatif (A, B, C, E à I ont la même forme) :

```tsx
// src/components/CalendarEventModal.tsx:134 (actuel)
<div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
  <motion.div
    ref={launchOriginRef}
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    className="w-full max-w-lg rounded-xl shadow-2xl overflow-hidden max-h-[90dvh] flex flex-col"
    style={{ background: 'var(--tblr-surface)' }}
  >
```

```tsx
// src/pages/Calendar.tsx:886 (actuel)
{eventModal && (
  <CalendarEventModal
    initial={eventModal}
    ...
  />
)}
```

```tsx
// src/components/InvoiceGenerator.tsx:244 (actuel)
<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
  <motion.div 
    ref={launchOriginRef}
    initial={{ opacity: 0, scale: 0.9, y: 20 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
```

## Cible

Pour chacune des 9 modales :

1. Le voile devient un `motion.div` qui apparaît et disparaît en fondu :
   `initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}`.
   Pas de `transition` explicite : le ressort par défaut `DEFAULT_SPRING`
   (`{ type: 'spring', bounce: 0, visualDuration: 0.3 }`, posé par
   `<MotionConfig>` dans `src/main.tsx`) s'applique.
2. Le panneau reçoit la sortie symétrique de son entrée :
   `exit={{ opacity: 0, scale: 0.9 }}` (et `exit={{ opacity: 0, scale: 0.9, y: 20 }}`
   pour D, dont l'entrée porte `y: 20`).
3. Le montage conditionnel est l'enfant direct d'un `<AnimatePresence>`, et le
   premier élément rendu porte une `key` stable et unique.

## Conventions du dépôt à suivre

- Exemplaire à imiter, déjà correct pour le panneau :
  `src/pages/Documents.tsx:621-629` (`<AnimatePresence>` autour du montage
  conditionnel, panneau avec `exit={{ opacity: 0, scale: 0.9 }}` et
  `ref={launchOriginRef}`).
- `AnimatePresence` et `motion` s'importent depuis `'motion/react'`.
- Motion joue les animations `exit` de tous les `motion.*` situés sous l'enfant
  direct de `AnimatePresence`, même s'ils sont rendus par un composant enfant :
  c'est ce qui permet d'animer A et B depuis la page qui les monte.
- Garder `ref={launchOriginRef}` sur le panneau : la sortie reprend alors le
  chemin d'entrée vers le déclencheur.

## Étapes

1. **A, `src/components/CalendarEventModal.tsx:134`** : remplacer la balise
   ouvrante du voile
   `<div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>`
   par
   `<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>`,
   et sa balise fermante `</div>` correspondante (la dernière du `return`) par
   `</motion.div>`. Sur le panneau, ajouter `exit={{ opacity: 0, scale: 0.9 }}`
   après `animate={{ opacity: 1, scale: 1 }}`.
2. **A, `src/pages/Calendar.tsx:886`** : envelopper `{eventModal && (<CalendarEventModal ... />)}`
   dans `<AnimatePresence>...</AnimatePresence>` et ajouter
   `key="calendar-event-modal"` sur `<CalendarEventModal`. Importer
   `AnimatePresence` depuis `'motion/react'` (ce fichier ne l'importe pas).
3. **B, `src/components/tasks/TaskFormModal.tsx:121`** : même transformation
   qu'à l'étape 1 (voile `<div ... style={{ background: 'rgba(0,0,0,0.5)' }}>`
   en `motion.div` avec fondu, `exit={{ opacity: 0, scale: 0.9 }}` sur le panneau).
4. **B, cinq points de montage** : `src/pages/Calendar.tsx:897`,
   `src/pages/Gantt.tsx:410`, `src/pages/Kanban.tsx:231`,
   `src/components/projectDetail/ProjectTasksTab.tsx:86`,
   `src/components/dashboard/MyTasksWidget.tsx:89`. Dans chacun, envelopper
   `{... && (<TaskFormModal ... />)}` dans `<AnimatePresence>`, ajouter
   `key="task-form-modal"` sur `<TaskFormModal`, et importer `AnimatePresence`
   depuis `'motion/react'` (aucun de ces cinq fichiers ne l'importe ; fusionner
   avec un import `motion/react` existant s'il y en a un).
5. **C, `src/components/ContactModal.tsx`** : changer l'import ligne 2 en
   `import { motion, AnimatePresence } from 'motion/react';`. Supprimer la
   ligne 164 `if (!isOpen) return null;`. Envelopper tout le JSX du `return`
   ainsi :
   ```tsx
   return (
     <AnimatePresence>
       {isOpen && (
         <motion.div
           key="contact-modal"
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           exit={{ opacity: 0 }}
           className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
         >
           <motion.div
             ref={launchOriginRef}
             initial={{ opacity: 0, scale: 0.9 }}
             animate={{ opacity: 1, scale: 1 }}
             exit={{ opacity: 0, scale: 0.9 }}
             ...le reste inchangé
           </motion.div>
         </motion.div>
       )}
     </AnimatePresence>
   );
   ```
   Vérifier qu'aucun hook n'est appelé après l'ancienne ligne 164 (ils sont
   tous au-dessus au commit bedc65f) ; sinon, S'ARRÊTER.
6. **D, `src/components/InvoiceGenerator.tsx:244`** : voile
   `<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">`
   en `motion.div` avec `initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}`
   (fermer avec `</motion.div>`), et ajouter
   `exit={{ opacity: 0, scale: 0.9, y: 20 }}` au panneau. Dans
   `src/pages/Invoices.tsx:1171`, ajouter `key="invoice-generator"` sur
   `<InvoiceGenerator` (l'`AnimatePresence` existe déjà ligne 1169).
7. **E, F, G, `src/pages/Contacts.tsx:914`, `:1026`, `:1081`** : pour chacun
   des trois blocs `{isModalOpen && (`, `{isCategoryModalOpen && (`,
   `{cardDavModal && (` : envelopper le bloc dans son propre
   `<AnimatePresence>`, transformer le voile
   `<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">`
   en `motion.div` avec `key` (`"contact-edit-modal"`, `"contact-category-modal"`,
   `"carddav-modal"`) et le fondu d'opacité, et ajouter
   `exit={{ opacity: 0, scale: 0.9 }}` au panneau. `AnimatePresence` est déjà
   importé (ligne 4).
8. **H, I, `src/pages/Projects.tsx:1709`, `:1757`** : même traitement qu'à
   l'étape 7 pour `{isCategoryModalOpen && (` (clé `"project-category-modal"`)
   et `{deleteTarget && (` (clé `"project-delete-modal"`). `AnimatePresence` est
   déjà importé (ligne 3).

## Limites

- Ne toucher à aucune autre modale (celles de `Documents.tsx`, `Invoices.tsx`,
  `OrdresDeService.tsx`, etc. ont déjà leur `exit`) ; en particulier, ne pas
  ajouter le fondu du voile aux autres modales dans ce plan.
- Ne pas changer les valeurs d'entrée existantes (`scale: 0.9`, `y: 20`), ni
  les classes, ni la logique de fermeture.
- Ne pas ajouter de `transition` explicite : le ressort par défaut suffit.
- Ne pas ajouter de dépendance.
- Si un extrait cité ne correspond plus au code (dérive depuis bedc65f),
  S'ARRÊTER et le signaler.

## Vérification

- **Mécanique** : `npm run lint`, `npm test`, `npm run build` passent.
  La console du navigateur ne montre aucun avertissement Motion sur des clés
  dupliquées dans `AnimatePresence`.
- **Ressenti**, pour chacune des 9 modales (calendrier : clic sur un
  événement ; tâches : `/kanban`, `/gantt`, `/calendar`, onglet Tâches d'une
  affaire, widget « Mes tâches » ; contact : bouton « Nouveau contact » depuis
  une affaire ; factures : ouvrir une facture ; `/contacts` : édition,
  catégories, CardDAV ; `/projects` : catégories, suppression) :
  - la modale se referme en rétrécissant vers le bouton qui l'a ouverte, au
    lieu de disparaître ;
  - le voile s'estompe en même temps et ne reste jamais visible seul ;
  - ouvrir puis refermer très vite (double-clic sur le déclencheur puis
    Échap) : l'animation repart de l'état affiché, sans saut ni clignotement ;
  - DevTools, vitesse 10 % : l'entrée et la sortie suivent le même chemin ;
  - émuler `prefers-reduced-motion: reduce` : seule l'opacité s'anime, plus
    aucune mise à l'échelle.
- **Terminé quand** : les 9 panneaux portent un `exit`, les 9 voiles sont des
  `motion.div` en fondu, chaque montage est sous un `AnimatePresence` avec une
  `key`, et les trois commandes passent.
