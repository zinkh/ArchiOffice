# Sources et hypothèses des chiffres

| Ligne | Valeur | Statut | Source ou raisonnement |
| --- | ---: | --- | --- |
| Prix moyen par agence | 38 €/mois | estimation | 70 % Starter (29 €) + 30 % Pro (59 €), paliers de `src/lib/billing.ts` ; Entreprise exclu |
| Frais de paiement | 1,5 % x 38 + 0,25 = 0,82 € | public, à confirmer | Stripe, cartes standard de l'EEE : [Wise](https://wise.com/fr/blog/stripe-carte-bancaire-paiement), [Indy](https://www.indy.fr/guide/comptabilite-en-ligne/commerce/stripe-comptabilite/frais-stripe/) ; prestataire réellement choisi non confirmé |
| Stockage et trafic par agence | 1,00 €/mois | estimation | aucun relevé réel |
| Supabase Pro et calcul | 35 €/mois | public, converti | Pro à 25 $ par mois et par organisation + calcul d'un second projet, d'après [Supabase](https://supabase.com/pricing.md) via [JetAdmin](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/) ; change dollar-euro non vérifié |
| Hébergement du serveur | 20 €/mois | estimation | hébergeur non connu |
| Domaine, courriel, outils | 15 €/mois | estimation | |
| Expert-comptable | 50 €/mois | estimation | |
| Assurance RC pro et cyber | 40 €/mois | estimation | |
| Temps payé (cas B) | 1 500 €/mois | hypothèse | aucun salaire connu ; cas A à 0 |
| Lancement (démos, salons, publicité) | 2 000 € | estimation | |
| CGV, RGPD, juridique | 1 500 € | estimation | |
| Rythme d'arrivée | 1 à 42 agences, 60 en régime | hypothèse | aucun canal défini |

L'outil calcule par « jour » : j'ai posé `days_per_month = 1`, donc les volumes sont des agences abonnées en fin de mois.
