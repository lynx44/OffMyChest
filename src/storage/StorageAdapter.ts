import { MessageManifest, Outbox, OutboxEntry } from '../shared/types';

/**
 * Storage provider interface.
 * Only GoogleDriveAdapter is implemented in V1.
 * Future providers (OneDrive, S3, etc.) implement this interface.
 */
export interface StorageAdapter {
  /** Upload a video chunk from a local file URI. Returns the public download URL. */
  uploadChunk(
    threadId: string,
    messageId: string,
    chunkIndex: number,
    fileUri: string,
  ): Promise<string>;

  /** Upload a message manifest JSON. Returns { url, fileId }. */
  uploadManifest(
    threadId: string,
    messageId: string,
    manifest: MessageManifest,
  ): Promise<{ url: string; fileId: string }>;

  /** Update an existing manifest file in-place. */
  updateManifest(fileId: string, manifest: MessageManifest): Promise<void>;

  /** Upload a thumbnail from a local file URI. Returns the public download URL. */
  uploadThumbnail(
    threadId: string,
    messageId: string,
    imageUri: string,
  ): Promise<string>;

  /** Fetch a manifest from any public URL. */
  getManifest(url: string): Promise<MessageManifest>;

  /** Resolve a chunk path (relative to base_url) to a full public download URL. */
  getChunkUrl(baseUrl: string, chunkPath: string): Promise<string>;

  /** Append a message entry to the user's outbox.json (serialized via queue). */
  updateOutbox(entry: OutboxEntry): Promise<void>;

  /** Read the current outbox.json (own user's). */
  readOwnOutbox(): Promise<Outbox>;
}
