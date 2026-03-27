import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';

import { DRIVE_FOLDER_NAME, OUTBOX_FILENAME, OUTBOX_VERSION, STORAGE_KEYS, publicDownloadUrl } from '../shared/constants';
import { MessageManifest, Outbox, OutboxEntry } from '../shared/types';
import { DriveApiError } from '../shared/errors';
import {
  DriveFile,
  fetchPublicJson,
  getOrCreateAppFolder,
  getOrCreateSubfolder,
  initiateResumableUpload,
  shareFilePublic,
  updateJsonFile,
  uploadJsonFile,
} from './driveApi';
import { StorageAdapter } from './StorageAdapter';
import { enqueueOutboxWrite } from './outboxQueue';

export class GoogleDriveAdapter implements StorageAdapter {
  private readonly userSub: string;
  private readonly userEmail: string;
  private readonly userName: string;
  private accessToken: string;
  private readonly getValidToken: (() => Promise<string>) | null;

  /** Cached Drive file ID for outbox.json */
  private outboxFileId: string | null = null;
  /** Cached root folder ID */
  private folderId: string | null = null;

  constructor(opts: {
    userSub: string;
    userEmail: string;
    userName: string;
    accessToken: string;
    getValidToken?: () => Promise<string>;
  }) {
    this.userSub = opts.userSub;
    this.userEmail = opts.userEmail;
    this.userName = opts.userName;
    this.accessToken = opts.accessToken;
    this.getValidToken = opts.getValidToken ?? null;
  }

  /** Call after token refresh to keep the adapter current. */
  updateAccessToken(token: string): void {
    this.accessToken = token;
  }

  /** Get a fresh token, refreshing if needed. */
  private async freshToken(): Promise<string> {
    if (this.getValidToken) {
      try {
        const token = await this.getValidToken();
        this.accessToken = token;
        return token;
      } catch {
        // Fall back to current token
      }
    }
    return this.accessToken;
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Ensure the /OffMyChest folder and outbox.json exist in Drive.
   * Safe to call on every app launch — searches before creating.
   * Returns the public URL of outbox.json.
   */
  async initialize(): Promise<string> {
    const folder = await this.getOrCacheFolder();
    const outboxUrl = await this.getOrCreateOutbox(folder.id);
    return outboxUrl;
  }

  private async getOrCacheFolder(): Promise<DriveFile> {
    // Check AsyncStorage cache
    const cached = await AsyncStorage.getItem(STORAGE_KEYS.driveFolderId(this.userSub));
    if (cached) {
      this.folderId = cached;
      return { id: cached, name: DRIVE_FOLDER_NAME };
    }

    // Search Drive (handles reinstall)
    const folder = await getOrCreateAppFolder(DRIVE_FOLDER_NAME, await this.freshToken());
    this.folderId = folder.id;
    await AsyncStorage.setItem(STORAGE_KEYS.driveFolderId(this.userSub), folder.id);
    return folder;
  }

  private async getOrCreateOutbox(folderId: string): Promise<string> {
    // Check AsyncStorage for existing outbox file ID + URL
    const [existingFileId, existingUrl] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.driveOutboxFileId(this.userSub)),
      AsyncStorage.getItem(STORAGE_KEYS.driveOutboxPublicUrl(this.userSub)),
    ]);

    if (existingFileId && existingUrl) {
      this.outboxFileId = existingFileId;
      return existingUrl;
    }

    // Create fresh outbox.json
    const emptyOutbox: Outbox = {
      version: OUTBOX_VERSION,
      owner: this.userName,
      owner_email: this.userEmail,
      updated_at: new Date().toISOString(),
      messages: [],
    };

    const token = await this.freshToken();
    const file = await uploadJsonFile(OUTBOX_FILENAME, emptyOutbox, folderId, token);
    const publicUrl = await shareFilePublic(file.id, token);

    this.outboxFileId = file.id;
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.driveOutboxFileId(this.userSub), file.id),
      AsyncStorage.setItem(STORAGE_KEYS.driveOutboxPublicUrl(this.userSub), publicUrl),
    ]);

    return publicUrl;
  }

  // ---------------------------------------------------------------------------
  // StorageAdapter implementation
  // ---------------------------------------------------------------------------

  async uploadChunk(
    threadId: string,
    messageId: string,
    chunkIndex: number,
    fileUri: string,
  ): Promise<string> {
    const folderId = await this.ensureFolderId();
    const chunkFolderId = await this.ensureSubfolder(
      `threads/${threadId}/${messageId}/chunks`,
      folderId,
    );
    const filename = `chunk_${String(chunkIndex).padStart(3, '0')}.mp4`;

    const token = await this.freshToken();
    const sessionUri = await initiateResumableUpload(
      filename,
      'video/mp4',
      chunkFolderId,
      token,
    );
    const file = await uploadFileViaSession(sessionUri, fileUri, 'video/mp4');
    return shareFilePublic(file.id, token);
  }

  async uploadManifest(
    threadId: string,
    messageId: string,
    manifest: MessageManifest,
  ): Promise<{ url: string; fileId: string }> {
    const folderId = await this.ensureFolderId();
    const msgFolderId = await this.ensureSubfolder(`threads/${threadId}/${messageId}`, folderId);

    const token = await this.freshToken();
    const file = await uploadJsonFile('manifest.json', manifest, msgFolderId, token);
    const url = await shareFilePublic(file.id, token);
    return { url, fileId: file.id };
  }

  async updateManifest(fileId: string, manifest: MessageManifest): Promise<void> {
    await updateJsonFile(fileId, manifest, await this.freshToken());
  }

  async uploadThumbnail(
    threadId: string,
    messageId: string,
    imageUri: string,
  ): Promise<string> {
    const folderId = await this.ensureFolderId();
    const msgFolderId = await this.ensureSubfolder(`threads/${threadId}/${messageId}`, folderId);

    const token = await this.freshToken();
    const sessionUri = await initiateResumableUpload(
      'thumb.jpg',
      'image/jpeg',
      msgFolderId,
      token,
    );
    const file = await uploadFileViaSession(sessionUri, imageUri, 'image/jpeg');
    return shareFilePublic(file.id, token);
  }

  async getManifest(url: string): Promise<MessageManifest> {
    return fetchPublicJson<MessageManifest>(url);
  }

  async getChunkUrl(baseUrl: string, chunkPath: string): Promise<string> {
    // Chunks are already public URLs stored in the manifest — just return them.
    // The baseUrl + chunkPath combination is only used for manifest-based resolution
    // in future providers; for Drive, chunk URLs are absolute public links.
    return `${baseUrl}${chunkPath}`;
  }

  async updateOutbox(entry: OutboxEntry): Promise<void> {
    return enqueueOutboxWrite(async () => {
      const [outboxUrl, cachedFileId] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.driveOutboxPublicUrl(this.userSub)),
        AsyncStorage.getItem(STORAGE_KEYS.driveOutboxFileId(this.userSub)),
      ]);
      if (cachedFileId) this.outboxFileId = cachedFileId;
      if (!outboxUrl || !this.outboxFileId) {
        throw new Error('Outbox not initialized — call initialize() first');
      }

      // Fetch latest to avoid stomping concurrent writes from other devices
      const current = await fetchPublicJson<Outbox>(outboxUrl);

      // Upsert by message_id — replace if exists, append if new
      const idx = current.messages.findIndex((m) => m.message_id === entry.message_id);
      if (idx >= 0) {
        current.messages[idx] = entry;
      } else {
        current.messages.push(entry);
      }
      current.updated_at = new Date().toISOString();

      await updateJsonFile(this.outboxFileId, current, await this.freshToken());
    });
  }

  async readOwnOutbox(): Promise<Outbox> {
    const outboxUrl = await AsyncStorage.getItem(
      STORAGE_KEYS.driveOutboxPublicUrl(this.userSub),
    );
    if (!outboxUrl) throw new Error('Outbox not initialized');
    return fetchPublicJson<Outbox>(outboxUrl);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async ensureFolderId(): Promise<string> {
    if (this.folderId) return this.folderId;
    const cached = await AsyncStorage.getItem(STORAGE_KEYS.driveFolderId(this.userSub));
    if (cached) {
      this.folderId = cached;
      return cached;
    }
    const folder = await this.getOrCacheFolder();
    return folder.id;
  }

  /**
   * Ensure a nested subfolder path exists under a parent folder.
   * Creates intermediate folders as needed.
   * Returns the final folder's Drive file ID.
   *
   * Note: Drive has no path concept — folders are files with a parent reference.
   * Each path segment is resolved in sequence.
   */
  private async ensureSubfolder(path: string, rootFolderId: string): Promise<string> {
    const segments = path.split('/');
    let currentParentId = rootFolderId;

    for (const segment of segments) {
      const folder = await getOrCreateSubfolder(segment, currentParentId, await this.freshToken());
      currentParentId = folder.id;
    }

    return currentParentId;
  }
}

// ---------------------------------------------------------------------------
// Module-level helper — streams a local file to a Drive resumable session URI
// Uses expo-file-system uploadAsync to avoid binary body issues with fetch.
// ---------------------------------------------------------------------------

async function uploadFileViaSession(
  sessionUri: string,
  localFileUri: string,
  mimeType: string,
): Promise<DriveFile> {
  const result = await uploadAsync(sessionUri, localFileUri, {
    httpMethod: 'PUT',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': mimeType },
  });

  if (result.status < 200 || result.status >= 300) {
    throw new DriveApiError(
      `File upload failed (${result.status})`,
      result.status,
      result.body,
    );
  }

  try {
    return JSON.parse(result.body) as DriveFile;
  } catch {
    throw new DriveApiError('Failed to parse Drive upload response', result.status, result.body);
  }
}
