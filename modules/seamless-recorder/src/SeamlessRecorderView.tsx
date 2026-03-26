import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { requireNativeView } from 'expo';
import { StyleProp, ViewStyle } from 'react-native';

export interface ChunkReadyEvent {
  index: number;
  uri: string;
}

export interface SeamlessRecorderRef {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
}

interface NativeProps {
  style?: StyleProp<ViewStyle>;
  facing?: 'front' | 'back';
  videoQuality?: '480p' | '720p' | '1080p';
  onChunkReady?: (event: { nativeEvent: ChunkReadyEvent }) => void;
  onError?: (event: { nativeEvent: { message: string } }) => void;
}

const NativeView = requireNativeView<NativeProps>('ExpoSeamlessRecorder');

interface Props {
  style?: StyleProp<ViewStyle>;
  facing?: 'front' | 'back';
  videoQuality?: '480p' | '720p' | '1080p';
  onChunkReady?: (event: ChunkReadyEvent) => void;
  onError?: (message: string) => void;
}

export const SeamlessRecorderView = forwardRef<SeamlessRecorderRef, Props>(
  function SeamlessRecorderView({ style, facing = 'front', videoQuality = '480p', onChunkReady, onError }, ref) {
    const nativeRef = useRef(null);

    useImperativeHandle(ref, () => ({
      async startRecording() {
        await (nativeRef.current as any)?.startRecording();
      },
      async stopRecording() {
        await (nativeRef.current as any)?.stopRecording();
      },
    }));

    return (
      <NativeView
        ref={nativeRef}
        style={style}
        facing={facing}
        videoQuality={videoQuality}
        onChunkReady={onChunkReady ? (e) => onChunkReady(e.nativeEvent) : undefined}
        onError={onError ? (e) => onError(e.nativeEvent.message) : undefined}
      />
    );
  }
);
