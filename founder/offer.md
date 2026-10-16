# Offre ArchiOffice, version 2

**Résultat du nouveau test : l'offre n'a pas aidé.** Les mêmes 20 acheteurs simulés (même graine, mêmes fiches) donnent **1 achat, 19 refus (5 %)**, contre **3 achats, 17 refus (15 %)** avec la première offre. Le panel est petit et un acheteur simulé varie d'un passage à l'autre : l'écart de deux achats ne prouve pas que l'offre a fait du tort. Il prouve en revanche qu'elle n'a rien débloqué.

## 1. La liste des problèmes (mots des acheteurs, panel et concurrents)

Avant d'acheter :
1. Je ne connais aucune agence qui l'utilise, je ne veux pas être le cobaye. (9 refus sur 19, en hausse)
2. Qui maintient ça dans cinq ans, si le créateur est occupé par sa propre agence ?
3. Si ça s'arrête ou que je pars, mes factures et mes données sont coincées.
4. Changer d'outil en cours de projets : reprise des affaires, contacts, prix, numérotation.
5. Mes tableurs marchent et ne coûtent rien.
6. Je ne sais pas si l'outil me met vraiment en règle pour la facturation électronique (plateforme agréée, émission et réception).
7. Je n'ai rien décidé sur l'obligation, rien ne presse.
8. Trop de modules, je n'en utilise que deux, je ne vois pas lequel est meilleur.
9. L'IA et l'assistance sont dans l'offre sur devis, sans prix : je ne sais pas à qui je parle si ça bloque.
10. Starter est limité à 2 utilisateurs, Pro à 59 € est au plafond de ce que je suis prêt à payer.
11. Où sont hébergées mes données (France, UE) ?

Pendant l'usage :
12. Je ne sais pas si le suivi de chantier et les réserves tiennent sur un téléphone, sans réseau.
13. Il faut du temps pour tout apprendre, avec trois chantiers en cours.
14. Une erreur sur une facture ou un document légal me coûte cher.

Après :
15. Et si je perds ce qui est saisi ou que l'outil disparaît ?
16. Impossible de savoir, avant d'avoir payé, si le gain justifie l'abonnement.

Reproches relevés chez les concurrents (`competitors.md`) : engagement annuel payé d'avance et résiliation difficile chez Vertuoza (donc : pas d'engagement annuel), application mobile jugée obsolète, prise en main longue.

## 2. Solutions, notées (valeur 1 à 5, coût 1 à 5, coût tiré du calcul financier)

| Problème | Solution | Valeur | Coût | Livrable ? |
| --- | --- | ---: | ---: | --- |
| 3, 15 | Export complet à tout moment (tableurs et fichiers) | 5 | 1 | Oui : existe déjà pour l'administrateur (`GET /api/settings/tenant-export`) |
| 4 | Mise en route accompagnée, 10 premières agences | 5 | 3 | Service, à votre charge (3 h par agence, estimation) |
| 9 | Support prioritaire affiché dans Pro | 4 | 1 | Oui : déjà dans la liste des fonctions de Pro, absent du pitch v1 |
| 16, 7 | Essai gratuit sur 3 vraies affaires | 4 | 1 | Oui : limites du palier d'essai (durée non vérifiée) |
| 16 | Satisfait ou remboursé 30 jours | 4 | 2 | À décider par vous (remboursement sur le premier mois payé) |
| 5, 16 | Sans engagement annuel | 3 | 1 | Cohérent avec l'abonnement mensuel, à confirmer |
| 1 | Tarif fondateur, prix bloqué 12 mois | 3 | 2 | Oui, date à fixer |
| 6 | Statut de plateforme agréée ou conformité attestée | 5 | ? | **Non vérifié**, ne rien affirmer |
| 1, 2 | Références d'agences, équipe identifiée, feuille de route | 5 | ? | **Impossible à fabriquer** : exige de vraies agences |
| 11 | Hébergement France ou UE | 4 | ? | **Non vérifié** (région non connue) |
| 12 | Démonstration du chantier sur téléphone | 4 | 2 | À produire (vidéo ou démo) |

## 3. L'empilement retenu

- **Le cœur** : un seul outil pour l'agence française, de la loi MOP à la facture Factur-X (EN 16931, envoi possible via Chorus Pro ou Super PDP), sur téléphone et tablette.
- **Bonus 1, mise en route accompagnée** (problème 4) : reprise de vos projets en cours, contacts et numérotation de factures, en visioconférence. Limitée aux 10 premières agences.
- **Bonus 2, export complet** (problèmes 3 et 15) : vos données vous appartiennent, à tout moment.
- **Bonus 3, support prioritaire dans Pro** (problème 9).
- **Garantie** : remboursement 30 jours sur le premier mois payé, sans engagement annuel.
- **Urgence réelle** : tarif fondateur pour 10 agences, jusqu'au 31 janvier 2027. Les 10 places et la date sont vraies tant que vous les respectez.
- **Nom de l'offre** : « Reprise accompagnée » (mise en route + export + garantie).

## 4. Ce que ça coûte (calcul financier, `cfo-offre.md`, cas B)

Coût estimé de l'offre : garantie étalée sur 24 mois (0,24 € par agence et par mois, en supposant 15 % de remboursements) et 1 500 € de mise en route offerte aux 10 premières agences (3 h à 50 €, estimation). Résultat : contribution par agence de 35,94 € (au lieu de 36,18 €), seuil de rentabilité de **47 agences** (au lieu de 46), trésorerie à avancer de **17 624 €** (au lieu de 16 075 €), année 1 à -12 624 €. L'offre est financable, mais elle élargit le besoin de trésorerie de 1 549 €. Le coût de la mise en route est du temps humain, pas de la trésorerie : il suppose que vous ou un collaborateur le fournissiez réellement.

## 5. Notes sur l'équation de la valeur (jugement, 1 à 10)

| Élément | Avant | Après | Ce qui bouge le score |
| --- | ---: | ---: | --- |
| Résultat visé | 5 | 6 | Factur-X + loi MOP nommés dans le cœur |
| Probabilité de l'obtenir | 3 | 4 | Garantie et export réduisent le risque, mais sans références elle reste faible |
| Délai du résultat | 4 | 5 | Mise en route accompagnée |
| Effort et sacrifice | 3 | 5 | Reprise des données, sans engagement annuel |

Ces notes sont mon jugement. Le nouveau test ne les confirme pas.

## 6. Ce que dit le nouveau test

| | Offre v1 | Offre v2 |
| --- | ---: | ---: |
| Achats | 3 sur 20 | 1 sur 20 |
| Refus pour confiance | 6 | 9 |
| Refus pour habitude | 8 | 7 |
| Refus pour besoin | 3 | 2 |
| Refus pour timing | 1 | 2 |
| Refus pour prix | 1 | 0 |

- **Seul P014 achète encore** (Elena, poussée par la facturation électronique, rassurée par l'essai et le remboursement à 30 jours). **P007 et P016 ne l'ont pas fait** : tous deux achetaient avec l'offre v1.
- **Le problème n°1 (aucune référence) revient dans 9 refus sur 19** et n'est pas adressé par l'offre : on ne peut pas fabriquer de références. Les 10 acheteurs « les premières agences » du pitch ont peut-être renforcé l'impression d'un produit pas encore éprouvé : à vérifier avec de vrais acheteurs, pas avec ce panel.
- **Le problème « tout de suite » n'est pas levé** : l'obligation de facturation électronique n'est pas perçue comme urgente par les refus (« rien ne presse »).
- Le prix n'est plus cité comme raison de refus.

## 7. Conclusion

Ce n'est pas l'offre qui bloque : c'est l'absence de preuves (références, équipe, statut de conformité vérifié, hébergement). Ces preuves ne s'écrivent pas dans un pitch.

**À faire avant de relancer un test simulé :**
1. Obtenir deux ou trois agences réelles qui utilisent ArchiOffice (même gratuitement, en échange d'un retour d'usage), pour avoir des références vraies.
2. Vérifier et écrire ce qui est factuel : statut vis-à-vis de la facturation électronique (plateforme agréée ou intégration à une plateforme), région d'hébergement, durée de l'essai.
3. Tester l'offre sur de vraies agences (page d'inscription, prévente, liste d'attente), pas sur ce panel.

Le pitch `pitch.md` garde l'offre v2 ; `pitch-v1.md` et `founder/panel-v1/` conservent le premier test.
