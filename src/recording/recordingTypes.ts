export interface RecordingSession {
  messageId: string;
  convId: string;
}

/** Uploaded chunk: index + public Drive download URL */
export interface UploadedChunk {
  index: number;
  publicUrl: string;
}

export type RecordingStatus =
  | 'idle'
  | 'recording'       // camera running, chunks uploading in background
  | 'stopping'        // stopRecording() called, waiting for final chunk
  | 'uploading'       // all chunks recorded, waiting for uploads to drain
  | 'finalizing'      // writing manifest + outbox
  | 'done'
  | 'error';
