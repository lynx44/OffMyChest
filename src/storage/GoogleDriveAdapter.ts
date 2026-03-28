import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';

import { DRIVE_FOLDER_NAME, OUTBOX_FILENAME, OUTBOX_VERSION, STORAGE_KEYS } from '../shared/constants';
import { MessageManifest, ConversationOutbox, OutboxEntry } from '../shared/types';
import { DriveApiError } from '../shared/errors';
import {
  DriveFile,
  deleteFile,
  fetchPublicJson,
  getFileParents,
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
  private readonly accessToken: string;
  private readonly getValidToken: (() => Promise<string>) | null;

  /** Cached root folder ID */
  private folderId: string | null = null;
  /** Cached conversation outbox file IDs: convId → Drive file ID */
  private convOutboxFileIds: Map<string, string> = new Map();

  constructor(opts: {
    userSub: string;
    userEmail: string;
    userName: string;
    accessToken: string;
    getValidToken?: () => Promise<string>;
  }) {
    this.userSub = opts.userSub;
    this.accessToken = opts.accessToken;
    this.getValidToken = opts.getValidToken ?? null;
  }

  /** Call after token refresh to keep the adapter current. */
  updateAccessToken(token: string): void {
    (this as any).accessToken = token;
  }

  /** Get a fresh token, refreshing if needed. */
  private async freshToken(): Promise<string> {
    if (this.getValidToken) {
      try {
        const token = await this.getValidToken();
        (this as any).accessToken = token;
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
   * Ensure the /OffMyChest folder exists in Drive.
   * Safe to call on every app launch.
   */
  async initialize(): Promise<void> {
    await this.getOrCacheFolder();
  }

  private async getOrCacheFolder(): Promise<DriveFile> {
    const cached = await AsyncStorage.getItem(STORAGE_KEYS.driveFolderId(this.userSub));
    if (cached) {
      this.folderId = cached;
      return { id: cached, name: DRIVE_FOLDER_NAME };
    }

    const folder = await getOrCreateAppFolder(DRIVE_FOLDER_NAME, await this.freshToken());
    this.folderId = folder.id;
    await AsyncStorage.setItem(STORAGE_KEYS.driveFolderId(this.userSub), folder.id);
    return folder;
  }

  // ---------------------------------------------------------------------------
  // Conversation outbox
  // ---------------------------------------------------------------------------

  /**
   * Create (or return cached) the outbox.json for this conversation.
   * Stored at conversations/{convId}/outbox.json in Drive.
   */
  async createConversationOutbox(convId: string): Promise<{ url: string; fileId: string }> {
    // Check in-memory cache
    const cachedFileId = this.convOutboxFileIds.get(convId);
    const cachedUrl = await AsyncStorage.getItem(STORAGE_KEYS.myConvOutboxUrl(convId));
    if (cachedFileId && cachedUrl) return { url: cachedUrl, fileId: cachedFileId };

    const storedFileId = await AsyncStorage.getItem(STORAGE_KEYS.myConvOutboxFileId(convId));
    if (storedFileId && cachedUrl) {
      this.convOutboxFileIds.set(convId, storedFileId);
      return { url: cachedUrl, fileId: storedFileId };
    }

    const folderId = await this.ensureFolderId();
    const convFolderId = await this.ensureSubfolder(`conversations/${convId}`, folderId);

    const emptyOutbox: ConversationOutbox = {
      version: OUTBOX_VERSION,
      updated_at: new Date().toISOString(),
      messages: [],
    };

    const token = await this.freshToken();
    const file = await uploadJsonFile(OUTBOX_FILENAME, emptyOutbox, convFolderId, token);
    const url = await shareFilePublic(file.id, token);

    this.convOutboxFileIds.set(convId, file.id);
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.myConvOutboxFileId(convId), file.id),
      AsyncStorage.setItem(STORAGE_KEYS.myConvOutboxUrl(convId), url),
    ]);

    return { url, fileId: file.id };
  }

  // ---------------------------------------------------------------------------
  // StorageAdapter implementation
  // ---------------------------------------------------------------------------

  async uploadChunk(
    convId: string,
    messageId: string,
    chunkIndex: number,
    fileUri: string,
  ): Promise<string> {
    const folderId = await this.ensureFolderId();
    const chunkFolderId = await this.ensureSubfolder(
      `conversations/${convId}/${messageId}/chunks`,
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
    convId: string,
    messageId: string,
    manifest: MessageManifest,
  ): Promise<{ url: string; fileId: string }> {
    const folderId = await this.ensureFolderId();
    const msgFolderId = await this.ensureSubfolder(
      `conversations/${convId}/${messageId}`,
      folderId,
    );

    const token = await this.freshToken();
    const file = await uploadJsonFile('manifest.json', manifest, msgFolderId, token);
    const url = await shareFilePublic(file.id, token);
    return { url, fileId: file.id };
  }

  async updateManifest(fileId: string, manifest: MessageManifest): Promise<void> {
    await updateJsonFile(fileId, manifest, await this.freshToken());
  }

  async uploadThumbnail(
    convId: string,
    messageId: string,
    imageUri: string,
  ): Promise<string> {
    const folderId = await this.ensureFolderId();
    const msgFolderId = await this.ensureSubfolder(
      `conversations/${convId}/${messageId}`,
      folderId,
    );

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
    return `${baseUrl}${chunkPath}`;
  }

  async updateOutbox(entry: OutboxEntry): Promise<void> {
    return enqueueOutboxWrite(async () => {
      const { fileId, url } = await this.createConversationOutbox(entry.conv_id);

      const current = await fetchPublicJson<ConversationOutbox>(url);

      const idx = current.messages.findIndex((m) => m.message_id === entry.message_id);
      if (idx >= 0) {
        current.messages[idx] = entry;
      } else {
        current.messages.push(entry);
      }
      current.updated_at = new Date().toISOString();

      await updateJsonFile(fileId, current, await this.freshToken());
    });
  }

  async readConversationOutbox(convId: string): Promise<ConversationOutbox> {
    const url = await AsyncStorage.getItem(STORAGE_KEYS.myConvOutboxUrl(convId));
    if (!url) return { version: OUTBOX_VERSION, updated_at: new Date().toISOString(), messages: [] };
    return fetchPublicJson<ConversationOutbox>(url);
  }

  async deleteMessage(manifestUrl: string, messageId: string, convId: string): Promise<void> {
    const token = await this.freshToken();

    const match = manifestUrl.match(/[?&]id=([^&]+)/);
    if (!match) throw new Error('Could not extract file ID from manifest URL');
    const manifestFileId = match[1];

    const parents = await getFileParents(manifestFileId, token);
    if (parents.length > 0) {
      await deleteFile(parents[0], token);
    } else {
      await deleteFile(manifestFileId, token);
    }

    await enqueueOutboxWrite(async () => {
      const outboxUrl = await AsyncStorage.getItem(STORAGE_KEYS.myConvOutboxUrl(convId));
      const outboxFileId = await AsyncStorage.getItem(STORAGE_KEYS.myConvOutboxFileId(convId));
      if (!outboxUrl || !outboxFileId) return;

      const current = await fetchPublicJson<ConversationOutbox>(outboxUrl);
      current.messages = current.messages.filter((m) => m.message_id !== messageId);
      current.updated_at = new Date().toISOString();
      await updateJsonFile(outboxFileId, current, await this.freshToken());
    });
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
