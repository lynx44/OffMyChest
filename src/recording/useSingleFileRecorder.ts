import { useCallback, useRef, useState } from 'react';
import { CameraView } from 'expo-camera';

const MAX_DURATION_SECONDS = 5 * 60; // 5 minutes hard cap

export interface SingleFileRecorderState {
  isRecording: boolean;
  elapsedSeconds: number;
}

export interface SingleFileRecorderControls {
  cameraRef: React.RefObject<CameraView | null>;
  /** Begin recording. Call stopRecording() when done. */
  startRecording: () => void;
  /** Stop recording. Resolves with the local file URI, or null on error. */
  stopRecording: () => Promise<string | null>;
  state: SingleFileRecorderState;
}

export function useSingleFileRecorder(): SingleFileRecorderControls {
  const cameraRef = useRef<CameraView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);

  const [state, setState] = useState<SingleFileRecorderState>({
    isRecording: false,
    elapsedSeconds: 0,
  });

  const startRecording = useCallback(() => {
    setState({ isRecording: true, elapsedSeconds: 0 });

    const start = Date.now();
    timerRef.current = setInterval(() => {
      setState((s) => ({ ...s, elapsedSeconds: Math.floor((Date.now() - start) / 1000) }));
    }, 1000);

    // Fire-and-forget — stopRecording() will await the promise
    recordPromiseRef.current =
      cameraRef.current?.recordAsync({ maxDuration: MAX_DURATION_SECONDS }) ??
      Promise.resolve(undefined);
  }, []);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setState((s) => ({ ...s, isRecording: false }));

    cameraRef.current?.stopRecording();

    try {
      const result = await recordPromiseRef.current;
      recordPromiseRef.current = null;
      return result?.uri ?? null;
    } catch {
      recordPromiseRef.current = null;
      return null;
    }
  }, []);

  return { cameraRef, startRecording, stopRecording, state };
}
