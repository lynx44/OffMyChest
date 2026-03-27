/**
 * Handles parallel chunk uploading while recording is in progress.
 * Publishes a manifest and outbox entry after the first chunk so
 * recipients can start watching while recording is still in progress.
 */

import { OUTBOX_VERSION } from '../shared/constants';
import { MessageManifest, OutboxEntry } from '../shared/types';
import { StorageAdapter } from '../storage/StorageAdapter';
import { updateDraftChunks, updateDraftStatus, clearDraft } from './draftStore';
import { captureThumbnail } from './thumbnailCapture';
import { RecordingSession, UploadedChunk } from './recordingTypes';

export class ChunkUploader {
  private readonly adapter: StorageAdapter;
  private readonly session: RecordingSession;
  private readonly senderEmail: string;

  /** Parallel upload promises, one per chunk */
  private readonly uploadPromises: Promise<UploadedChunk>[] = [];

  /** URI of the first chunk — used for thumbnail capture */
  private firstChunkUri: string | null = null;

  /** Ordered list of public URLs for uploaded chunks */
  private readonly chunkUrls: string[] = [];

  /** Drive file ID of the manifest (set after first publish) */
  private manifestFileId: string | null = null;
  /** Public URL of the manifest */
  private manifestUrl: string | null = null;
  /** Whether the outbox entry has been created */
  private outboxPublished = false;
  /** Serializes manifest updates so they don't race */
  private manifestQueue: Promise<void> = Promise.resolve();

  constructor(adapter: StorageAdapter, session: RecordingSession, senderEmail: string) {
    this.adapter = adapter;
    this.session = session;
    this.senderEmail = senderEmail;
  }

  /**
   * Enqueue a chunk for upload. Returns immediately — upload runs in background.
   */
  enqueueChunk(index: number, fileUri: string): void {
    if (index === 0) this.firstChunkUri = fileUri;

    const promise = this.uploadChunkInternal(index, fileUri);
    this.uploadPromises.push(promise);
  }

  private async uploadChunkInternal(index: number, fileUri: string): Promise<UploadedChunk> {
    try {
      console.log(`[Upload] chunk ${index} uploading from ${fileUri}`);
      const publicUrl = await this.adapter.uploadChunk(
        this.session.threadId,
        this.session.messageId,
        index,
        fileUri,
      );
      console.log(`[Upload] chunk ${index} done: ${publicUrl}`);
      await updateDraftChunks(this.session.messageId, publicUrl);

      // Track the URL in order
      this.chunkUrls[index] = publicUrl;

      // Publish or update manifest
      this.enqueueManifestUpdate();

      return { index, publicUrl };
    } catch (err) {
      console.error(`[Upload] chunk ${index} FAILED:`, err);
      throw err;
    }
  }

  /** Serialized manifest publish/update so concurrent uploads don't race */
  private enqueueManifestUpdate(): void {
    this.manifestQueue = this.manifestQueue
      .then(() => this.publishOrUpdateManifest())
      .catch((err) => console.error('[Upload] manifest update failed:', err));
  }

  private async publishOrUpdateManifest(): Promise<void> {
    // Collect contiguous chunk URLs (skip any gaps from still-uploading chunks)
    const contiguous: string[] = [];
    for (let i = 0; i < this.chunkUrls.length; i++) {
      if (this.chunkUrls[i]) contiguous.push(this.chunkUrls[i]);
      else break;
    }
    if (contiguous.length === 0) return;

    const manifest: MessageManifest = {
      version: OUTBOX_VERSION,
      message_id: this.session.messageId,
      thread_id: this.session.threadId,
      group_id: this.session.groupId,
      sender: this.senderEmail,
      timestamp: new Date().toISOString(),
      duration_seconds: 0, // unknown while recording
      chunks: contiguous,
      thumbnail: '',
      base_url: '',
      status: 'recording',
    };

    if (!this.manifestFileId) {
      // First publish
      const { url, fileId } = await this.adapter.uploadManifest(
        this.session.threadId,
        this.session.messageId,
        manifest,
      );
      this.manifestFileId = fileId;
      this.manifestUrl = url;
      console.log(`[Upload] manifest published: ${url}`);
    } else {
      // Update existing manifest with new chunks
      await this.adapter.updateManifest(this.manifestFileId, manifest);
      console.log(`[Upload] manifest updated: ${contiguous.length} chunks`);
    }

    // Publish outbox entry on first manifest publish
    if (!this.outboxPublished && this.manifestUrl) {
      const entry: OutboxEntry = {
        message_id: this.session.messageId,
        thread_id: this.session.threadId,
        group_id: this.session.groupId,
        timestamp: manifest.timestamp,
        duration_seconds: 0,
        manifest_url: this.manifestUrl,
        thumbnail_url: '',
        status: 'recording',
      };
      await this.adapter.updateOutbox(entry);
      this.outboxPublished = true;
      console.log('[Upload] outbox entry published (recording)');
    }
  }

  /**
   * Wait for all enqueued chunk uploads to complete.
   * Returns the uploaded chunks sorted by index.
   */
  async waitForAll(): Promise<UploadedChunk[]> {
    const results = await Promise.all(this.uploadPromises);
    // Also wait for any pending manifest update
    await this.manifestQueue;
    return results.sort((a, b) => a.index - b.index);
  }

  /**
   * Capture a thumbnail from the first chunk's local file.
   * Must be called while the local file still exists (before a new recording starts).
   * Returns the local thumbnail URI, or null on failure.
   */
  async captureThumbnailNow(): Promise<string | null> {
    if (!this.firstChunkUri) return null;
    try {
      return await captureThumbnail(this.firstChunkUri);
    } catch (err) {
      console.warn('Thumbnail capture failed:', err);
      return null;
    }
  }

  /**
   * Finalize with pre-uploaded chunks and pre-captured thumbnail.
   * This method does NOT access local files, so it's safe to call after the
   * native recorder has been restarted for a new recording.
   */
  async finalizeWithChunks(
    uploadedChunks: UploadedChunk[],
    thumbnailUri: string | null,
    totalDurationSeconds: number,
    senderEmail: string,
  ): Promise<void> {
    await updateDraftStatus(this.session.messageId, 'finalizing');

    // Upload thumbnail if captured
    let thumbnailUrl = '';
    if (thumbnailUri) {
      try {
        thumbnailUrl = await this.adapter.uploadThumbnail(
          this.session.threadId,
          this.session.messageId,
          thumbnailUri,
        );
      } catch (err) {
        console.warn('Thumbnail upload failed, continuing without it:', err);
      }
    }

    // Build final manifest
    const chunkCount = uploadedChunks.length;
    const manifest: MessageManifest = {
      version: OUTBOX_VERSION,
      message_id: this.session.messageId,
      thread_id: this.session.threadId,
      group_id: this.session.groupId,
      sender: senderEmail,
      timestamp: new Date().toISOString(),
      duration_seconds: totalDurationSeconds,
      chunk_duration_seconds: chunkCount > 0 ? totalDurationSeconds / chunkCount : 0,
      chunks: uploadedChunks.map((c) => c.publicUrl),
      thumbnail: thumbnailUrl,
      base_url: '',
      status: 'complete',
    };

    if (this.manifestFileId) {
      await this.adapter.updateManifest(this.manifestFileId, manifest);
    } else {
      const { url, fileId } = await this.adapter.uploadManifest(
        this.session.threadId,
        this.session.messageId,
        manifest,
      );
      this.manifestFileId = fileId;
      this.manifestUrl = url;
    }

    const entry: OutboxEntry = {
      message_id: this.session.messageId,
      thread_id: this.session.threadId,
      group_id: this.session.groupId,
      timestamp: manifest.timestamp,
      duration_seconds: totalDurationSeconds,
      manifest_url: this.manifestUrl!,
      thumbnail_url: thumbnailUrl,
      status: 'complete',
    };

    await this.adapter.updateOutbox(entry);
    await clearDraft(this.session.messageId);
  }

  /**
   * Finalize: update manifest to 'complete', add thumbnail, update outbox duration.
   * Call after waitForAll() resolves.
   * @deprecated Use captureThumbnailNow() + finalizeWithChunks() for background-safe finalization.
   */
  async finalize(
    uploadedChunks: UploadedChunk[],
    totalDurationSeconds: number,
    senderEmail: string,
  ): Promise<void> {
    const thumbnailUri = await this.captureThumbnailNow();
    return this.finalizeWithChunks(uploadedChunks, thumbnailUri, totalDurationSeconds, senderEmail);
  }
}
