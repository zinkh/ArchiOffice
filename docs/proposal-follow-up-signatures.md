# Suivi des propositions et signature électronique

## Parcours livré

La liste des propositions dispose de quatre vues : actives, à relancer, à archiver après 60 jours sans réponse, archivées. L'archivage conserve le statut commercial et les données ; la restauration réactive la proposition. Les propositions acceptées, refusées, ayant reçu une réponse ou en signature ne sont pas proposées à l'archivage sans réponse.

Le bouton « Suivi client » permet de planifier une relance, préparer un e-mail modifiable depuis les comptes de messagerie existants, signaler une réponse et archiver/restaurer. La date et le compteur de relance sont enregistrés après confirmation d'envoi de la messagerie. Le délai proposé est de 14 jours. Aucun envoi ni archivage automatique : les actions sont explicites. Une réponse est signalée manuellement ; la boîte mail n'est pas analysée pour en déduire une réponse.

Les dates d'envoi historiques inconnues ne sont pas inventées : ces propositions restent accessibles, avec une date de relance planifiable manuellement.

## Fournisseurs

1. Firma.dev est le fournisseur par défaut uniquement si le superadmin l'active dans `/admin`. La clé maître est configurée côté serveur via `FIRMA_API_KEY` ; elle n'est jamais renvoyée au navigateur. Un espace isolé par cabinet est créé au premier envoi, avec une clé de workspace chiffrée. Un master key de test utilise la clé de workspace de test.
2. Sans activation de Firma, le cabinet utilise le plugin DocuSeal ou Zoho Sign sélectionné dans Paramètres > Intégrations. Les clés DocuSeal sont chiffrées ; les régions cloud Europe (.eu) et internationale (.com) sont proposées. L'API PDF DocuSeal nécessite une offre adaptée. L'auto-hébergement DocuSeal n'est pas exposé dans cette version.
3. Zoho Sign utilise les identifiants OAuth Zoho déjà présents, mais possède son propre refresh token et ses propres scopes. Il ne déconnecte ni Zoho Invoice ni Zoho Books.

Chaque demande enregistre le fournisseur et la région utilisés au départ. Les demandes existantes restent suivies par ce fournisseur après un changement du défaut. La déconnexion ou le remplacement des identifiants du compte peut empêcher la lecture des demandes de l'ancien compte ; conserver le compte tant que son historique est nécessaire.

Le PDF généré dans l'aperçu est envoyé au signataire avec une page A4 de signature ajoutée à la fin. Le nom, l'e-mail et le fournisseur sont visibles avant le clic d'envoi. Le suivi permet d'actualiser le statut puis de télécharger le PDF signé. La signature terminée arrête les relances ; l'acceptation commerciale et la création de projet restent une action explicite du parcours existant.

## Déploiement

- Appliquer `supabase/migrate_proposal_follow_up_sign.sql` avant le déploiement. Le schéma neuf contient les mêmes ajouts. La migration est additive et rejouable ; les tables existantes conservent leurs politiques RLS.
- Configurer `MAIL_ENCRYPTION_KEY` (32 octets en base64) pour le chiffrement des clés et jetons.
- Firma : configurer `FIRMA_API_KEY` dans l'environnement serveur, puis activer depuis le compte superadmin. L'activation reste désactivée par défaut.
- Zoho : `APP_URL` doit être l'URL publique de l'instance ; enregistrer `https://www.archioffice.fr/api/zoho-sign/callback` dans la console Zoho si c'est le domaine de l'instance. Une surcharge `ZOHO_SIGN_REDIRECT_URI` est disponible.
- Scopes Zoho : `ZohoSign.documents.CREATE,ZohoSign.documents.READ,ZohoSign.documents.UPDATE`.

Aucune clé de production n'est fournie et aucune demande de signature réelle n'est envoyée par les tests. Recette finale avec les comptes de test de chaque fournisseur avant activation en production.

## Reprise et limites

Un verrou en base empêche les doubles créations. L'identifiant externe est enregistré avant la soumission Zoho. Après un timeout ambigu, l'état reste « envoi à vérifier » ; aucun nouvel envoi automatique n'est effectué. Actualiser la signature lorsqu'un identifiant est connu. Sans identifiant, vérifier chez le fournisseur et réconcilier les métadonnées avant de reprendre ; ne jamais effacer le verrou sans cette vérification. Même règle pour un workspace Firma resté à l'état `unknown` : retrouver l'espace existant et rattacher ses identifiants, plutôt que le recréer aveuglément.

Cette première version suit une signature client par proposition, sans webhook fournisseur, contresignature ni relance automatique de signature. Le statut est actualisé par le bouton de suivi. Une nouvelle version à signer se traite comme une nouvelle proposition ; un document en cours de signature n'est pas modifiable.

## Vérification

`tests/proposalFollowUpSignatures.test.ts` couvre le suivi, les droits, le chiffrement, l'isolation multi-cabinets, les payloads des fournisseurs, le verrou anti-doublon, la reprise après timeout et l'OAuth Zoho (state à usage unique). Les services distants sont simulés.

Références API : [Firma](https://docs.firma.dev/api-reference/signing-requests/create-and-send-signing-request-atomic), [workspaces Firma](https://docs.firma.dev/guides/multi-tenant), [DocuSeal](https://www.docuseal.com/docs/api), [Zoho Sign](https://www.zoho.com/sign/api/document-managment/send-document-for-signature.html).
