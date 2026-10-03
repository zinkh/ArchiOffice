---
target: page ProjectDetail
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/home/user/ArchiOffice/src/pages/ProjectDetail.tsx"
target_fingerprint: "sha256:2dff75d972aba59590ebf6d2cfdacf5433c7ece2822963d530663135c1ecaf93"
target_path: /home/user/ArchiOffice/src/pages/ProjectDetail.tsx
timestamp: 2026-10-03T15-16-53Z
slug: src-pages-projectdetail-tsx
---
# Critique ProjectDetail.tsx : 21/40 (Acceptable)

| # | Heuristique | Note | Problème |
|---|---|---|---|
| 1 | Visibilité de l'état | 2 | Pas d'indicateur « non enregistré » ; facture créée sans retour |
| 2 | Monde réel | 4 | Vocabulaire MOP exemplaire |
| 3 | Contrôle | 1 | Annuler (:1712) jette les saisies ; ?tab supprimé (:369) |
| 4 | Cohérence | 1 | Trois modèles d'enregistrement ; stepper vs onglets homonymes |
| 5 | Prévention | 2 | Facture brouillon en un clic |
| 6 | Reconnaissance | 2 | Icônes sans libellé (:3017-3023) ; HONOS/RDT |
| 7 | Efficacité | 2 | Pas de raccourcis, onglet non persistant |
| 8 | Minimalisme | 2 | HONOS ~1200 lignes empilées |
| 9 | Erreurs | 2 | 17 alert() ; saveNote ignore res.ok |
| 10 | Aide | 3 | Aides contextuelles utiles |

## Problèmes prioritaires
- [P0] Trois modèles d'enregistrement, pertes silencieuses (aperçu via bouton en-tête :947-973, Annuler :1712 sans garde). harden.
- [P1] Facture brouillon en un clic depuis icône zinc-300 14px (:2594, :3011-3016), « Facture créée » non lien, saveNote sans res.ok (:2568). harden, clarify.
- [P1] 10 onglets + stepper 10 pastilles homonymes (:1740-1751, :1665-1697), libellés hors i18n. distill, layout.
- [P2] Accessibilité : 0 aria/role, PillTabs sans tablist, modales sans dialog/Échap/focus (:5477-5568), jalons div onClick 14px, <tr onClick> :4567 :5231, 20 outline-none sans remplacement. audit, harden.
- [P2] Dérive charte : bleus/zinc Tailwind, text-zinc-300, 0.9375rem x8, 0.625rem (:4793, PillTabs:47), couleurs inline sans dark (ProjectOverview:196-197, MafCostBadge), <a href> rechargeant, « Loading project... » / « Milestones » en anglais. polish.

## Persona
Alex : onglet perdu, alert bloquante. Sam : onglets/modales/tr inaccessibles. Chantier : cibles 14-22px, Enregistrer en haut, observations perdues.

## Mineurs
:1639 chargement sans erreur ; :1880 tuiles avenants rouge/vert ; :1940 toFixed(10) et « — » en number ; :1966 grid-cols-4 mobile ; :2957 double clic note ; :5030 w-full.
