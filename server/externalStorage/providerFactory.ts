// Le seul endroit qui transforme une ligne `external_storage_connections` en
// adaptateur utilisable. Les adaptateurs réels arrivent par lots (WebDAV, puis
// Google Drive, puis Dropbox) ; tant qu'un fournisseur n'a pas le sien, sa
// connexion ne peut pas être créée depuis l'UI, et une ligne qui existerait
// quand même échoue ici avec un message explicite plutôt que silencieusement.
import { ExternalStorageError, type ExternalStorageProvider } from './provider';
import type { ExternalStorageConnection } from './externalConnection';

export type ProviderFactory = (connection: ExternalStorageConnection) => ExternalStorageProvider;

const factories = new Map<string, ProviderFactory>();

/** Enregistre l'adaptateur d'un fournisseur. Appelé au chargement de chaque
 *  module d'adaptateur, et par les tests pour brancher un fournisseur en mémoire. */
export function registerProviderFactory(kind: string, factory: ProviderFactory): void {
  factories.set(kind, factory);
}

export function hasProviderFactory(kind: string): boolean {
  return factories.has(kind);
}

export function createProvider(connection: ExternalStorageConnection): ExternalStorageProvider {
  const factory = factories.get(connection.provider);
  if (!factory) {
    throw new ExternalStorageError(
      `Le connecteur de stockage « ${connection.provider} » n'est pas disponible sur cette instance.`,
      'unknown',
      503,
    );
  }
  return factory(connection);
}
