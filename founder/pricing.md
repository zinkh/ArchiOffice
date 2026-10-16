# Prix d'ArchiOffice

**Limites.** Les réponses de prix viennent de 20 acheteurs simulés : elles indiquent quoi tester, elles ne prouvent rien. Aucun calcul de marge n'est possible ici : `founder/numbers.json` n'existe pas, `/founder-cfo` n'a pas été lancé, et je n'invente aucun coût (hébergement, IA, support). La courbe détaillée est dans `founder/pricing-curve.md`.

## 1. Le prix

**Garder Starter à 29 € par mois. Tester Pro à 49 € contre 59 €.**

- **Starter 29 €** : le point d'indifférence du panel (IPP) est à 29,17 €. Autant d'acheteurs le jugent « une affaire » que « cher ». Il est dans la fourchette acceptable (14,78 € à 59,95 €).
- **Pro 59 €** : il touche le plafond du panel (PME 59,95 €). Au-dessus, trop d'acheteurs ne l'achètent plus. La réponse médiane « ça commence à être cher » est à 45 €. Pro à 59 € n'a donc aucune marge et la moitié du panel le trouve cher.
- **Marché** (voir `founder/competitors.md`) : médiane d'entrée des concurrents proche de 39 € (OOTI), ArchiTek à 29 €, Archipad à 54,99 € par utilisateur. Starter à 29 € se place à l'entrée du marché, Pro à 59 € au niveau de l'outil de chantier le plus cher, avec une promesse plus large mais sans références.
- **Le prix n'est pas le frein principal.** Seul 1 refus sur 17 est classé « prix » ; 14 le sont pour l'habitude ou la confiance. Baisser le prix ne règle donc pas le problème : lever les freins d'abord (`/founder-offer`).

## 2. L'échelle (bon, meilleur, le meilleur)

| Palier | Prix | Pour qui | Raison de monter |
| --- | ---: | --- | --- |
| Essai gratuit | 0 € | tester sur une vraie affaire | 3 projets, 1 utilisateur, 100 Mo atteints |
| Starter | 29 € | architecte seul | passer à plus de 2 utilisateurs ou 10 projets |
| Pro | 49 € ou 59 € (à tester) | petite agence | projets illimités, 10 utilisateurs, intégrations |
| Entreprise | sur devis | 10 personnes et plus | IA, support, formation |

**Point à corriger.** 4 acheteurs sur 20 bloquent sur le fait que l'IA et l'assistance sont dans l'offre « sur devis » sans prix : « Le prix par palier me convient mais l'IA et l'assistance sont réservées à l'offre sur devis, et je ne vois pas de prix pour ça » (P003). Afficher un prix de départ ou inclure un niveau de support dans Pro lèverait l'incertitude sans toucher le prix de base.

## 3. L'offre d'ouverture

Pas de réduction affichée : elle habituerait les acheteurs à attendre. Une proposition à valider : **tarif fondateur** pour les premières agences, prix du palier choisi **bloqué 12 mois**, en échange d'un retour d'usage et d'un témoignage réel (le panel demande des références, voir plus bas). Date de fin à fixer, par exemple 31 janvier 2027. Aucun faux prix de référence : le prix barré n'a jamais été facturé.

Le panel demande aussi un essai « assez long pour tester une vraie affaire avec import de mes données ». La durée actuelle de l'essai n'est pas dans les données que j'ai lues : à vérifier avant de la promettre.

## 4. À tester avec de vrais acheteurs

Deux prix dans la fourchette, sur la même page d'inscription avec une prévente ou une liste d'attente :
1. **Pro à 49 €** contre **Pro à 59 €**, tout le reste identique. Mesurer l'inscription à l'essai puis le passage payant.
2. **Pro avec support inclus** contre **Pro sans support**, pour savoir si l'incertitude sur l'assistance bloque plus que le prix.

À lancer avec `/founder-launch`. Il faut quelques dizaines d'agences réelles par variante pour que la comparaison compte.

## 5. Objections de prix du panel, mot pour mot

1. « Le prix par palier me convient mais l'IA et l'assistance sont réservées à l'offre sur devis, et je ne vois pas de prix pour ça. Je n'ai aucune preuve que ça remplace vraiment mes outils actuels. » (P003)
2. « Je ne connais aucune agence qui l'utilise, je n'ai pas lu d'avis, et l'IA et l'assistance sont réservées à l'offre sur devis. Si les données sont bloquées le jour où je veux partir, je perds mes CCTP et mes factures. » (P016)
3. « Avec 6 à 15 personnes, l'IA et l'assistance sont dans l'offre sur devis : je ne sais pas à qui je parle si ça bloque. » (P020)

## Suite
Lancer `/founder-cfo` pour obtenir la marge réelle par palier, avec le coût de l'IA et de l'hébergement, avant de fixer Pro. Puis `/founder-offer`.
