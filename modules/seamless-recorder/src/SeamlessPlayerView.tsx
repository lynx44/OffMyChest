import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { requireNativeModule, requireNativeView } from 'expo';
import { StyleProp, ViewStyle } from 'react-native';

const PlayerModule = requireNativeModule('ExpoSeamlessPlayer');

export async function startBackgroundPlayback(): Promise<void> {
  await PlayerModule.startBackgroundPlayback();
}

export async function stopBackgroundPlayback(): Promise<void> {
  await PlayerModule.stopBackgroundPlayback();
}

export interface SeamlessPlayerRef {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  getPositionMs: () => Promise<number>;
  getElapsedMs: () => Promise<number>;
  seekTo: (positionMs: number) => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  appendChunks: (urls: string[]) => Promise<void>;
  getLoadedChunkCount: () => Promise<number>;
  seekToChunk: (windowIndex: number) => Promise<void>;
  setVolumeBoost: (level: number) => Promise<void>;
}

interface NativeProps {
  style?: StyleProp<ViewStyle>;
  chunks?: string[];
  startPosition?: number;
  liveMode?: boolean;
  onPlaybackFinished?: (event: { nativeEvent: Record<string, never> }) => void;
  onPlaybackError?: (event: { nativeEvent: { message: string } }) => void;
  onLiveCaughtUp?: (event: { nativeEvent: Record<string, never> }) => void;
}

const NativeView = requireNativeView<NativeProps>('ExpoSeamlessPlayer');

interface Props {
  style?: StyleProp<ViewStyle>;
  chunks: string[];
  startPosition?: number;
  liveMode?: boolean;
  onPlaybackFinished?: () => void;
  onPlaybackError?: (message: string) => void;
  onLiveCaughtUp?: () => void;
}

export const SeamlessPlayerView = forwardRef<SeamlessPlayerRef, Props>(
  function SeamlessPlayerView({ style, chunks, startPosition, liveMode, onPlaybackFinished, onPlaybackError, onLiveCaughtUp }, ref) {
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
      async seekToChunk(windowIndex: number) {
        await (nativeRef.current as any)?.seekToChunk(windowIndex);
      },
      async setVolumeBoost(level: number) {
        await (nativeRef.current as any)?.setVolumeBoost(level);
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
        onLiveCaughtUp={onLiveCaughtUp ? () => onLiveCaughtUp() : undefined}
      />
    );
  }
);
