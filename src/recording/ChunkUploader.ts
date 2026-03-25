/**
 * Handles parallel chunk uploading while recording is in progress.
 * Each chunk upload fires immediately (non-blocking). Call waitForAll()
 * after recording stops to drain the queue before finalizing.
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

  /** Parallel upload promises, one per chunk */
  private readonly uploadPromises: Promise<UploadedChunk>[] = [];

  /** URI of the first chunk — used for thumbnail capture */
  private firstChunkUri: string | null = null;

  constructor(adapter: StorageAdapter, session: RecordingSession) {
    this.adapter = adapter;
    this.session = session;
  }

  /**
   * Enqueue a chunk for upload. Returns immediately — upload runs in background.
   * Call this as soon as a chunk file is available from the recorder.
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
      return { index, publicUrl };
    } catch (err) {
      console.error(`[Upload] chunk ${index} FAILED:`, err);
      throw err;
    }
  }

  /**
   * Wait for all enqueued chunk uploads to complete.
   * Returns the uploaded chunks sorted by index.
   */
  async waitForAll(): Promise<UploadedChunk[]> {
    const results = await Promise.all(this.uploadPromises);
    return results.sort((a, b) => a.index - b.index);
  }

  /**
   * Upload thumbnail, write manifest, append to outbox, clear draft.
   * Call after waitForAll() resolves.
   */
  async finalize(
    uploadedChunks: UploadedChunk[],
    totalDurationSeconds: number,
    senderEmail: string,
  ): Promise<void> {
    await updateDraftStatus(this.session.messageId, 'finalizing');

    // Upload thumbnail from first chunk
    let thumbnailUrl = '';
    if (this.firstChunkUri) {
      try {
        const thumbUri = await captureThumbnail(this.firstChunkUri);
        thumbnailUrl = await this.adapter.uploadThumbnail(
          this.session.threadId,
          this.session.messageId,
          thumbUri,
        );
      } catch (err) {
        console.warn('Thumbnail capture failed, continuing without it:', err);
      }
    }

    // Build manifest — chunk URLs are already absolute public Drive URLs
    const manifest: MessageManifest = {
      version: OUTBOX_VERSION,
      message_id: this.session.messageId,
      thread_id: this.session.threadId,
      group_id: this.session.groupId,
      sender: senderEmail,
      timestamp: new Date().toISOString(),
      duration_seconds: totalDurationSeconds,
      chunks: uploadedChunks.map((c) => c.publicUrl),
      thumbnail: thumbnailUrl,
      base_url: '', // chunks are absolute URLs, base_url unused for Drive
    };

    const manifestUrl = await this.adapter.uploadManifest(
      this.session.threadId,
      this.session.messageId,
      manifest,
    );

    // Append to outbox
    const entry: OutboxEntry = {
      message_id: this.session.messageId,
      thread_id: this.session.threadId,
      group_id: this.session.groupId,
      timestamp: manifest.timestamp,
      duration_seconds: totalDurationSeconds,
      manifest_url: manifestUrl,
      thumbnail_url: thumbnailUrl,
    };

    await this.adapter.updateOutbox(entry);
    await clearDraft(this.session.messageId);
  }
}

