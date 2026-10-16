# Unit economics: ArchiOffice avec l'offre v2 (cas B : 1 500 EUR par mois de temps payé)

Every number below comes from the input file. Nothing is looked up or guessed.

## One agence abonnée

| line | per agence abonnée |
| --- | ---: |
| Price | 38 € |
| Frais de paiement carte (1,5 % x 38 + 0,25) | -0,82 € |
| Stockage et trafic par agence (estimation) | -1 € |
| Garantie 30 jours (estimation : 15 % remboursent 38 EUR, étalés sur 24 mois) | -0,24 € |
| **Contribution** (what each agence abonnée leaves to pay the fixed costs) | **35,94 €** (95%) |

## The margin that matters

Fixed costs: 1 660 € a month (Supabase Pro et calcul (estimation) 35  € Hébergement du serveur (estimation) 20  € Domaine, courriel, outils (estimation) 15  € Expert-comptable (estimation) 50  € Assurance RC pro et cyber (estimation) 40  € Temps payé : support et développement (hypothèse) 1 500 €).

- **Break-even: 47 agences abonnées.** Below that you lose money every month.
- **Profit margin at your plan** (60 a day): **22%** of every sale, after every cost.

## Year 1, month by month

| month | agences abonnées | revenue | profit | cumulative (after 5 000 € startup) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 38 € | -1 624 € | -6 624 € |
| 2 | 2 | 76 € | -1 588 € | -8 212 € |
| 3 | 4 | 152 € | -1 516 € | -9 728 € |
| 4 | 6 | 228 € | -1 444 € | -11 173 € |
| 5 | 9 | 342 € | -1 337 € | -12 509 € |
| 6 | 12 | 456 € | -1 229 € | -13 738 € |
| 7 | 16 | 608 € | -1 085 € | -14 823 € |
| 8 | 20 | 760 € | -941 € | -15 764 € |
| 9 | 25 | 950 € | -762 € | -16 526 € |
| 10 | 30 | 1 140 € | -582 € | -17 108 € |
| 11 | 36 | 1 368 € | -366 € | -17 474 € |
| 12 | 42 | 1 596 € | -151 € | -17 624 € |

- **Year 1 operating profit: -12 624 €** on 7 714 € of revenue.
- After the 5 000 € startup spend: -17 624 €.
- Startup money earned back: not within year 1.
- Cash you need before it pays for itself: **17 624 €**.

## What if

| scenario | margin at plan | break-even a day | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | 22% | 47 | -12 624 € |
| Price -10% | 13% | 52 | -13 396 € |
| Volume -20% | 4% | 47 | -14 083 € |
| Unit costs +15% | 21% | 47 | -12 687 € |

## Red flags

- Year 1 loses money on operations (-12 624 €).
- The startup spend is not earned back within year 1.
