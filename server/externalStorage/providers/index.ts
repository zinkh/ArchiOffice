// Enregistre les adaptateurs de stockage externe auprès de providerFactory.ts.
//
// Une fonction plutôt qu'un import à effet de bord : Google Drive a besoin de
// `supabaseAdmin` pour repersister l'identifiant de son dossier racine et un
// jeton renouvelé, et un import ne peut rien recevoir.
//
// Un fournisseur absent d'ici n'est pas « à moitié branché » : sa carte
// n'apparaît pas dans les Réglages, et une ligne de connexion qui le
// désignerait malgré tout échoue avec un message explicite (createProvider).
import { registerWebdavProvider } from './webdav';
import { registerGoogleDriveProvider } from './googleDrive';

export function registerStorageProviders(supabaseAdmin: any): void {
  registerWebdavProvider();
  registerGoogleDriveProvider(supabaseAdmin);
}
