import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { requireNativeView } from 'expo';
import { StyleProp, ViewStyle } from 'react-native';

export interface SeamlessPlayerRef {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  getPositionMs: () => Promise<number>;
  getElapsedMs: () => Promise<number>;
  seekTo: (positionMs: number) => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  appendChunks: (urls: string[]) => Promise<void>;
  getLoadedChunkCount: () => Promise<number>;
}

interface NativeProps {
  style?: StyleProp<ViewStyle>;
  chunks?: string[];
  startPosition?: number;
  liveMode?: boolean;
  onPlaybackFinished?: (event: { nativeEvent: Record<string, never> }) => void;
  onPlaybackError?: (event: { nativeEvent: { message: string } }) => void;
}

const NativeView = requireNativeView<NativeProps>('ExpoSeamlessPlayer');

interface Props {
  style?: StyleProp<ViewStyle>;
  chunks: string[];
  startPosition?: number;
  liveMode?: boolean;
  onPlaybackFinished?: () => void;
  onPlaybackError?: (message: string) => void;
}

export const SeamlessPlayerView = forwardRef<SeamlessPlayerRef, Props>(
  function SeamlessPlayerView({ style, chunks, startPosition, liveMode, onPlaybackFinished, onPlaybackError }, ref) {
    const nativeRef = useRef(null);

    useImperativeHandle(ref, () => ({
      async play() {
        await (nativeRef.current as any)?.play();
      },
      async pause() {
        await (nativeRef.current as any)?.pause();
      },
      async getPositionMs(): Promise<number> {
        return (await (nativeRef.current as any)?.getPositionMs()) ?? 0;
      },
      async getElapsedMs(): Promise<number> {
        return (await (nativeRef.current as any)?.getElapsedMs()) ?? 0;
      },
      async seekTo(positionMs: number) {
        await (nativeRef.current as any)?.seekTo(positionMs);
      },
      async setSpeed(speed: number) {
        await (nativeRef.current as any)?.setSpeed(speed);
      },
      async appendChunks(urls: string[]) {
        await (nativeRef.current as any)?.appendChunks(urls);
      },
      async getLoadedChunkCount(): Promise<number> {
        return (await (nativeRef.current as any)?.getLoadedChunkCount()) ?? 0;
      },
    }));

    return (
      <NativeView
        ref={nativeRef}
        style={style}
        chunks={chunks}
        startPosition={startPosition}
        liveMode={liveMode}
        onPlaybackFinished={onPlaybackFinished ? () => onPlaybackFinished() : undefined}
        onPlaybackError={onPlaybackError ? (e) => onPlaybackError(e.nativeEvent.message) : undefined}
      />
    );
  }
);
