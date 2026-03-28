import { ConversationOutbox, MessageManifest, OutboxEntry } from '../shared/types';

/**
 * Storage provider interface.
 * Only GoogleDriveAdapter is implemented in V1.
 * Future providers (OneDrive, S3, etc.) implement this interface.
 */
export interface StorageAdapter {
  /** Upload a video chunk from a local file URI. Returns the public download URL. */
  uploadChunk(
    convId: string,
    messageId: string,
    chunkIndex: number,
    fileUri: string,
  ): Promise<string>;

  /** Upload a message manifest JSON. Returns { url, fileId }. */
  uploadManifest(
    convId: string,
    messageId: string,
    manifest: MessageManifest,
  ): Promise<{ url: string; fileId: string }>;

  /** Update an existing manifest file in-place. */
  updateManifest(fileId: string, manifest: MessageManifest): Promise<void>;

  /** Upload a thumbnail from a local file URI. Returns the public download URL. */
  uploadThumbnail(
    convId: string,
    messageId: string,
    imageUri: string,
  ): Promise<string>;

  /** Fetch a manifest from any public URL. */
  getManifest(url: string): Promise<MessageManifest>;

  /** Resolve a chunk path (relative to base_url) to a full public download URL. */
  getChunkUrl(baseUrl: string, chunkPath: string): Promise<string>;

  /** Upsert a message entry into the conversation outbox (serialized via queue). */
  updateOutbox(entry: OutboxEntry): Promise<void>;

  /** Read the outbox for a given convId. */
  readConversationOutbox(convId: string): Promise<ConversationOutbox>;

  /**
   * Create a fresh outbox file for this conversation on Drive.
   * Returns { url, fileId }.
   * Safe to call multiple times — returns cached result if already created.
   */
  createConversationOutbox(convId: string): Promise<{ url: string; fileId: string }>;

  /**
   * Delete a message the user owns:
   * - Removes the message folder (and all chunks/thumbnail/manifest) from Drive
   * - Removes the entry from the conversation outbox
   */
  deleteMessage(manifestUrl: string, messageId: string, convId: string): Promise<void>;
}
