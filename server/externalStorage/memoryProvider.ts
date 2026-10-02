// Un fournisseur de stockage entièrement en mémoire, pour les tests.
//
// `tests/fakeSupabaseAdmin.ts` émule PostgREST et Supabase Storage, mais aucun
// drive : sans ce double, il n'y aurait aucun moyen de vérifier de bout en bout
// qu'un dépôt part bien chez le cabinet, que l'arborescence créée est la bonne,
// ou que le cache de dossiers évite réellement des appels. Il compte donc ses
// appels et sait simuler une panne.
//
// Il n'est enregistré que lorsque VITEST est défini (voir registerMemoryProvider
// plus bas, appelé depuis tests/testServer.ts) : rien de tout ceci n'existe en
// production.
import { Readable } from 'stream';
import {
  ExternalFolderMissingError,
  type ExternalReadStream,
  type ExternalStorageKind,
  type ExternalStorageProvider,
  type ExternalUploadResult,
} from './provider';
import { registerProviderFactory } from './providerFactory';

interface MemoryFolder {
  id: string;
  parentId: string | null;
  name: string;
}
interface MemoryFile {
  id: string;
  parentId: string;
  name: string;
  buffer: Buffer;
  mimeType: string;
  trashed: boolean;
}

/** L'état partagé par tous les fournisseurs mémoire d'un fichier de test. */
export class MemoryDrive {
  folders = new Map<string, MemoryFolder>();
  files = new Map<string, MemoryFile>();
  findCalls = 0;
  createCalls = 0;
  uploadCalls = 0;
  deleteCalls = 0;
  lastRangeHeader: string | undefined;
  /** Renvoyé par getTemporaryLink ; null = le fournisseur n'en produit pas. */
  temporaryLink: string | null = null;
  private failNext: Error | null = null;
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  reset(): void {
    this.folders.clear();
    this.files.clear();
    this.findCalls = 0;
    this.createCalls = 0;
    this.uploadCalls = 0;
    this.deleteCalls = 0;
    this.lastRangeHeader = undefined;
    this.failNext = null;
  }

  resetCounters(): void {
    this.findCalls = 0;
    this.createCalls = 0;
    this.uploadCalls = 0;
  }

  /** Fait échouer le prochain uploadFile, pour exercer la reprise sur cache périmé. */
  failNextUploadWith(error: Error): void {
    this.failNext = error;
  }

  takeFailure(): Error | null {
    const err = this.failNext;
    this.failNext = null;
    return err;
  }

  newFolderId(): string {
    return this.nextId('folder');
  }
  newFileId(): string {
    return this.nextId('file');
  }

  /** Le chemin complet d'un dossier, pour les assertions de test. */
  pathOfFolder(folderId: string): string {
    const parts: string[] = [];
    let current = this.folders.get(folderId);
    while (current) {
      parts.unshift(current.name);
      current = current.parentId ? this.folders.get(current.parentId) : undefined;
    }
    return parts.join('/');
  }

  /** Le chemin complet d'un fichier — « ArchiOffice/26014 - Villa Martin/DCE/cctp.pdf ». */
  pathOfFile(fileId: string): string | null {
    const file = this.files.get(fileId);
    if (!file) return null;
    return `${this.pathOfFolder(file.parentId)}/${file.name}`;
  }

  /** Tous les chemins de fichiers vivants, triés — assertion la plus lisible. */
  livePaths(): string[] {
    return [...this.files.values()]
      .filter((f) => !f.trashed)
      .map((f) => `${this.pathOfFolder(f.parentId)}/${f.name}`)
      .sort();
  }
}

export const memoryDrive = new MemoryDrive();

class MemoryProvider implements ExternalStorageProvider {
  readonly kind: ExternalStorageKind;
  constructor(
    kind: ExternalStorageKind,
    private readonly rootName: string,
    private readonly drive: MemoryDrive,
  ) {
    this.kind = kind;
  }

  async resolveRoot(): Promise<string> {
    for (const folder of this.drive.folders.values()) {
      if (folder.parentId === null && folder.name === this.rootName) return folder.id;
    }
    const id = this.drive.newFolderId();
    this.drive.folders.set(id, { id, parentId: null, name: this.rootName });
    return id;
  }

  async findChildFolder(parentExternalId: string, name: string): Promise<string | null> {
    this.drive.findCalls += 1;
    for (const folder of this.drive.folders.values()) {
      if (folder.parentId === parentExternalId && folder.name === name) return folder.id;
    }
    return null;
  }

  async createChildFolder(parentExternalId: string, name: string): Promise<string> {
    this.drive.createCalls += 1;
    if (!this.drive.folders.has(parentExternalId)) {
      throw new ExternalFolderMissingError();
    }
    const id = this.drive.newFolderId();
    this.drive.folders.set(id, { id, parentId: parentExternalId, name });
    return id;
  }

  async uploadFile(
    parentExternalId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<ExternalUploadResult> {
    const failure = this.drive.takeFailure();
    if (failure) throw failure;
    this.drive.uploadCalls += 1;
    if (!this.drive.folders.has(parentExternalId)) throw new ExternalFolderMissingError();
    const id = this.drive.newFileId();
    this.drive.files.set(id, { id, parentId: parentExternalId, name: fileName, buffer, mimeType, trashed: false });
    return { externalId: id, sizeBytes: buffer.length, webUrl: null };
  }

  async deleteFile(externalId: string): Promise<void> {
    this.drive.deleteCalls += 1;
    const file = this.drive.files.get(externalId);
    if (file) file.trashed = true;
  }

  async getTemporaryLink(): Promise<string | null> {
    return this.drive.temporaryLink;
  }

  async openReadStream(externalId: string, rangeHeader?: string): Promise<ExternalReadStream> {
    this.drive.lastRangeHeader = rangeHeader;
    const file = this.drive.files.get(externalId);
    if (!file || file.trashed) throw new ExternalFolderMissingError('Fichier introuvable');

    const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : file.buffer.length - 1;
      const slice = file.buffer.subarray(start, end + 1);
      return {
        body: Readable.from(slice),
        contentType: file.mimeType,
        contentLength: slice.length,
        status: 206,
        contentRange: `bytes ${start}-${end}/${file.buffer.length}`,
      };
    }
    return {
      body: Readable.from(file.buffer),
      contentType: file.mimeType,
      contentLength: file.buffer.length,
      status: 200,
      contentRange: null,
    };
  }

  async probe(): Promise<void> {
    await this.resolveRoot();
  }
}

/** Branche le fournisseur mémoire sur les trois types, pour que les tests
 *  puissent semer une connexion de n'importe quel fournisseur. */
export function registerMemoryProvider(drive: MemoryDrive = memoryDrive): void {
  for (const kind of ['google_drive', 'dropbox', 'webdav'] as ExternalStorageKind[]) {
    registerProviderFactory(kind, (connection) => new MemoryProvider(kind, connection.root_folder_path, drive));
  }
}
