#!/usr/bin/env node
// Génère la paire de clés VAPID des notifications poussées (server/push.ts).
//
// Une paire par instance, générée une seule fois : la clé publique est
// enregistrée dans chaque abonnement de navigateur, donc la faire tourner
// invalide tous les abonnements existants (les clients se réabonnent d'
// eux-mêmes au démarrage suivant, voir enablePush() dans src/lib/push.ts,
// mais la personne ne reçoit rien entre-temps).
//
//   node scripts/generate-vapid-keys.mjs
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
# À reporter dans .env (ou dans les variables d'environnement de l'hébergeur).
# VAPID_PRIVATE_KEY ne doit jamais quitter le serveur ; VAPID_PUBLIC_KEY est
# publique par construction, elle voyage dans chaque abonnement.
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:contact@aazs.fr
`.trim());
