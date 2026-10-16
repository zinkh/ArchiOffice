# Note du directeur financier : ArchiOffice

**Avertissement.** Aucun chiffre ci-dessous ne vient de devis réels : tous les coûts sont des **estimations posées par moi** (voir `cfo-sources.md`), sauf les frais de paiement et le tarif Supabase, qui s'appuient sur des sources publiques citées. Le détail de l'outil, plus bas, est en euros hors taxes ; l'outil affichait des « $ » par défaut, convertis ici. Ce n'est ni un conseil financier, fiscal ou juridique : un expert-comptable doit vérifier la structure, la TVA et la paie avant tout engagement.

## Deux cas, un seul écart : le temps de travail
- **Cas A, temps non payé** (`cfo-cas-a.md`) : charges fixes de 160 €/mois. Seuil de rentabilité : **5 agences**. Marge à 60 agences : 88 %. Bénéfice d'exploitation en année 1 : 5 425 €. Trésorerie à avancer : 3 727 €.
- **Cas B, 1 500 €/mois de temps payé** (ce fichier, `cfo.md`) : charges fixes de 1 660 €/mois. Seuil de rentabilité : **46 agences**. Marge à 60 agences : 22 %. Année 1 : **-12 575 €** d'exploitation, **16 075 €** de trésorerie à avancer, départ non récupéré en année 1.

**Le cas A paraît rentable uniquement parce que le temps du fondateur est gratuit.** Le cas B est plus proche d'une entreprise réelle. La ligne à surveiller est donc le temps payé et le rythme d'arrivée des agences.

## La marge
Une agence abonnée rapporte **36,18 €** par mois après ses propres coûts (prix moyen 38 €, frais de paiement 0,82 €, stockage estimé 1,00 €), soit 95 % du prix. Le prix moyen de 38 € suppose 70 % de Starter à 29 € et 30 % de Pro à 59 € : c'est une hypothèse, pas une mesure. Le palier Entreprise (IA, support) est exclu du calcul.

## La ligne à surveiller
Le **rythme d'arrivée des agences** et le **temps payé**. Preuves par l'outil, cas B :
- Volume +50 % (90 agences en régime) : marge 47 %, année 1 à -8 903 €, trésorerie 13 316 €.
- Prix moyen 44 € (mix 50/50) : seuil à 40 agences, marge 33 %, année 1 à -11 357 €.
- Temps payé réduit à 750 €/mois : seuil à 26 agences, marge 55 %, année 1 à -3 575 €, trésorerie 8 253 €.
- Volume -20 % : marge 4 %, année 1 à -14 044 €.

## La trésorerie
Cas B : environ **16 000 €** avant que l'activité se paie seule, sans atteindre le seuil de rentabilité en année 1 (la 12e mois est à -140 €). Cas A : environ 3 700 €.

## Trois façons d'améliorer la marge
1. **Atteindre le volume** : chaque agence de plus rapporte 36,18 € par mois. +50 % de volume améliore l'année 1 d'environ 3 700 € (cas B).
2. **Monter le prix moyen** par le mix (plus de Pro) ou par le support inclus : passer de 38 € à 44 € ramène le seuil de 46 à 40 agences. À l'inverse, Pro à 49 € au lieu de 59 € ramène le prix moyen à 35 € : seuil à 51 agences, marge 16 %, année 1 à -13 184 € (cas B). Le test de prix proposé dans `pricing.md` a donc un coût réel.
3. **Réduire le temps payé** par l'automatisation de l'accueil (import, export, aide intégrée) : 750 €/mois au lieu de 1 500 €/mois baisse le seuil à 26 agences.

## Les conditions d'argent du conseil
- « Montrer la marge par palier, coût de l'IA compris » : **non remplie.** L'IA est hors calcul, et la marge est calculée sur un prix moyen, pas par palier.
- « Un niveau de chiffre d'affaires qui fait vivre l'activité aux prix actuels » : **partiellement.** Le seuil est connu (5 ou 46 agences selon le temps payé), pas le canal qui les amène.
- « Un coût d'acquisition mesuré » : **non remplie.** Aucun canal n'est défini ; le budget de lancement de 2 000 € est une estimation.

## Ce que la montée en charge ne modélise pas
Le rythme d'arrivée (1 agence le premier mois, 42 au douzième) n'est pas déduit du panel : le panel simulé donne seulement un taux d'achat de 15 % parmi les acheteurs atteints (borne haute) et ne dit rien du nombre d'agences atteintes. L'outil ne modélise ni le départ des abonnés ni la TVA (les revenus sont hors taxes).

---

# Unit economics: ArchiOffice, abonnement mensuel pour agences d'architecture (cas B : avec 1 500 EUR par mois de temps payé)

Every number below comes from the input file. Nothing is looked up or guessed.

## One agence abonnée

| line | par agence abonnée |
| --- | ---: |
| Price | 38 € |
| Frais de paiement carte (1,5 % x 38 + 0,25) | -0,82 € |
| Stockage et trafic par agence (estimation) | -1 € |
| **Contribution** (what each agence abonnée leaves to pay the fixed costs) | **36,18 €** (95%) |

## The margin that matters

Fixed costs: 1 660 € a month (Supabase Pro et calcul (estimation) 35  € Hébergement du serveur (estimation) 20  € Domaine, courriel, outils (estimation) 15  € Expert-comptable (estimation) 50  € Assurance RC pro et cyber (estimation) 40  € Temps payé : support et développement (hypothèse) 1 500 €).

- **Break-even: 46 agences abonnées.** Below that you lose money every month.
- **Profit margin at your plan** (60 a day): **22%** of every sale, after every cost.

## Year 1, month by month

| month | agences abonnées | revenue | profit | cumulative (after 3 500 € startup) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 38 € | -1 624 € | -5 124 € |
| 2 | 2 | 76 € | -1 588 € | -6 711 € |
| 3 | 4 | 152 € | -1 515 € | -8 227 € |
| 4 | 6 | 228 € | -1 443 € | -9 670 € |
| 5 | 9 | 342 € | -1 334 € | -11 004 € |
| 6 | 12 | 456 € | -1 226 € | -12 230 € |
| 7 | 16 | 608 € | -1 081 € | -13 311 € |
| 8 | 20 | 760 € | -936 € | -14 247 € |
| 9 | 25 | 950 € | -756 € | -15 003 € |
| 10 | 30 | 1 140 € | -575 € | -15 578 € |
| 11 | 36 | 1 368 € | -358 € | -15 935 € |
| 12 | 42 | 1 596 € | -140 € | -16 075 € |

- **Year 1 operating profit: -12 575 €** on 7 714 € of revenue.
- After the 3 500 € startup spend: -16 075 €.
- Startup money earned back: not within year 1.
- Cash you need before it pays for itself: **16 075 €**.

## What if

| scenario | margin at plan | break-even a day | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | 22% | 46 | -12 575 € |
| Price -10% | 14% | 52 | -13 347 € |
| Volume -20% | 4% | 46 | -14 044 € |
| Unit costs +15% | 22% | 47 | -12 631 € |

## Red flags

- Year 1 loses money on operations (-12 575 €).
- The startup spend is not earned back within year 1.
