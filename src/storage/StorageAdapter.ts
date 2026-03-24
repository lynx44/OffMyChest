import { MessageManifest, Outbox, OutboxEntry } from '../shared/types';

/**
 * Storage provider interface.
 * Only GoogleDriveAdapter is implemented in V1.
 * Future providers (OneDrive, S3, etc.) implement this interface.
 */
export interface StorageAdapter {
  /** Upload a video chunk. Returns the public download URL. */
  uploadChunk(
    threadId: string,
    messageId: string,
    chunkIndex: number,
    data: Uint8Array,
  ): Promise<string>;

  /** Upload a message manifest JSON. Returns the public download URL. */
  uploadManifest(
    threadId: string,
    messageId: string,
    manifest: MessageManifest,
  ): Promise<string>;

  /** Upload a thumbnail image. Returns the public download URL. */
  uploadThumbnail(
    threadId: string,
    messageId: string,
    image: Uint8Array,
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
