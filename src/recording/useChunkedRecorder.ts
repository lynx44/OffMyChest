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
  stopRecording: () => void;
  state: ChunkedRecorderState;
}

export function useChunkedRecorder(): ChunkedRecorderControls {
  const cameraRef = useRef<CameraView>(null);
  const userStoppedRef = useRef(false);
  const chunkIndexRef = useRef(0);
  const onChunkReadyRef = useRef<((index: number, uri: string) => void) | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [state, setState] = useState<ChunkedRecorderState>({
    isRecording: false,
    chunkCount: 0,
    elapsedSeconds: 0,
  });

  const recordNextChunk = useCallback(async () => {
    if (!cameraRef.current || userStoppedRef.current) return;

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

      // Auto-restart for the next chunk if user hasn't stopped
      if (!userStoppedRef.current) {
        recordNextChunk();
      }
    } catch (err) {
      // Recording was stopped externally or camera was unmounted
      console.warn('Chunk recording ended:', err);
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

  const stopRecording = useCallback(() => {
    userStoppedRef.current = true;

    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }

    setState((s) => ({ ...s, isRecording: false }));
    cameraRef.current?.stopRecording();
  }, []);

  return { cameraRef, startRecording, stopRecording, state };
}
