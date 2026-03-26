import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { requireNativeView } from 'expo';
import { StyleProp, ViewStyle } from 'react-native';

export interface SeamlessPlayerRef {
  play: () => Promise<void>;
  pause: () => Promise<void>;
}

interface NativeProps {
  style?: StyleProp<ViewStyle>;
  chunks?: string[];
  onPlaybackFinished?: (event: { nativeEvent: Record<string, never> }) => void;
  onPlaybackError?: (event: { nativeEvent: { message: string } }) => void;
}

const NativeView = requireNativeView<NativeProps>('ExpoSeamlessPlayer');

interface Props {
  style?: StyleProp<ViewStyle>;
  chunks: string[];
  onPlaybackFinished?: () => void;
  onPlaybackError?: (message: string) => void;
}

export const SeamlessPlayerView = forwardRef<SeamlessPlayerRef, Props>(
  function SeamlessPlayerView({ style, chunks, onPlaybackFinished, onPlaybackError }, ref) {
    const nativeRef = useRef(null);

    useImperativeHandle(ref, () => ({
      async play() {
        await (nativeRef.current as any)?.play();
      },
      async pause() {
        await (nativeRef.current as any)?.pause();
      },
    }));

    return (
      <NativeView
        ref={nativeRef}
        style={style}
        chunks={chunks}
        onPlaybackFinished={onPlaybackFinished ? () => onPlaybackFinished() : undefined}
        onPlaybackError={onPlaybackError ? (e) => onPlaybackError(e.nativeEvent.message) : undefined}
      />
    );
  }
);
