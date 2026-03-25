/**
 * Manages expo-camera stop-restart chunked recording.
 *
 * Strategy: recordAsync({ maxDuration: CHUNK_DURATION_SECONDS }) auto-resolves
 * each chunk. After each chunk resolves, we immediately restart if the user
 * hasn't stopped. When the user taps stop, we set a flag and call stopRecording()
 * on the current chunk — it resolves as the final partial chunk.
 *
 * Fallback: if stop-restart proves too jarring on low-end Android, swap this
 * hook for useSingleFileRecorder which records one continuous file.
 */

import { useRef, useState, useCallback } from 'react';
import { CameraView } from 'expo-camera';

import { CHUNK_DURATION_SECONDS } from '../shared/constants';

export interface ChunkedRecorderState {
  isRecording: boolean;
  chunkCount: number;
  elapsedSeconds: number;
}

export interface ChunkedRecorderControls {
  cameraRef: React.RefObject<CameraView | null>;
  startRecording: (onChunkReady: (index: number, uri: string) => void) => void;
  /** Stops recording and returns a Promise that resolves once the final chunk callback has fired. */
  stopRecording: () => Promise<void>;
  state: ChunkedRecorderState;
}

export function useChunkedRecorder(): ChunkedRecorderControls {
  const cameraRef = useRef<CameraView>(null);
  const userStoppedRef = useRef(false);
  const chunkIndexRef = useRef(0);
  const onChunkReadyRef = useRef<((index: number, uri: string) => void) | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Resolves when the final chunk's callback has been called (or recording aborted). */
  const stopResolveRef = useRef<(() => void) | null>(null);

  const [state, setState] = useState<ChunkedRecorderState>({
    isRecording: false,
    chunkCount: 0,
    elapsedSeconds: 0,
  });

  const recordNextChunk = useCallback(async () => {
    if (!cameraRef.current || userStoppedRef.current) {
      stopResolveRef.current?.();
      stopResolveRef.current = null;
      return;
    }

    try {
      // recordAsync resolves when maxDuration is hit OR stopRecording() is called
      const result = await cameraRef.current.recordAsync({
        maxDuration: CHUNK_DURATION_SECONDS,
      });

      if (result?.uri) {
        const index = chunkIndexRef.current++;
        setState((s) => ({ ...s, chunkCount: index + 1 }));
        onChunkReadyRef.current?.(index, result.uri);
      }

      if (!userStoppedRef.current) {
        // Auto-restart for the next chunk
        recordNextChunk();
      } else {
        // Final chunk processed — signal stop is complete
        stopResolveRef.current?.();
        stopResolveRef.current = null;
      }
    } catch (err) {
      // Recording was stopped externally or camera was unmounted
      console.warn('Chunk recording ended:', err);
      stopResolveRef.current?.();
      stopResolveRef.current = null;
    }
  }, []);

  const startRecording = useCallback(
    (onChunkReady: (index: number, uri: string) => void) => {
      userStoppedRef.current = false;
      chunkIndexRef.current = 0;
      onChunkReadyRef.current = onChunkReady;

      setState({ isRecording: true, chunkCount: 0, elapsedSeconds: 0 });

      // Start elapsed timer
      const start = Date.now();
      elapsedTimerRef.current = setInterval(() => {
        setState((s) => ({
          ...s,
          elapsedSeconds: Math.floor((Date.now() - start) / 1000),
        }));
      }, 1000);

      recordNextChunk();
    },
    [recordNextChunk],
  );

  const stopRecording = useCallback((): Promise<void> => {
    userStoppedRef.current = true;

    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }

    setState((s) => ({ ...s, isRecording: false }));

    return new Promise<void>((resolve) => {
      stopResolveRef.current = resolve;
      cameraRef.current?.stopRecording();

      // Safety valve: if the camera never calls back, unblock after 3s
      setTimeout(() => {
        if (stopResolveRef.current === resolve) {
          console.warn('[Recorder] stopRecording timeout — proceeding without final chunk');
          stopResolveRef.current = null;
          resolve();
        }
      }, 3000);
    });
  }, []);

  return { cameraRef, startRecording, stopRecording, state };
}
