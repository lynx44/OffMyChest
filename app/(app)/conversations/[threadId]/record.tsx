import * as Crypto from 'expo-crypto';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../../../../src/auth/GoogleAuthProvider';
import { ChunkUploader } from '../../../../src/recording/ChunkUploader';
import { saveDraft, updateDraftStatus } from '../../../../src/recording/draftStore';
import { useStorageAdapter } from '../../../../src/storage/useStorageAdapter';
import { RecordingStatus } from '../../../../src/recording/recordingTypes';
import {
  SeamlessRecorderView,
  SeamlessRecorderRef,
  ChunkReadyEvent,
} from '../../../../modules/seamless-recorder/src';

export default function RecordScreen() {
  const { threadId, groupId } = useLocalSearchParams<{
    threadId: string;
    groupId?: string;
  }>();
  const { user } = useAuth();
  const adapter = useStorageAdapter();
  const router = useRouter();

  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recorderRef = useRef<SeamlessRecorderRef>(null);
  const messageIdRef = useRef<string>('');
  const uploaderRef = useRef<ChunkUploader | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (!permission || !micPermission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted || !micPermission.granted) {
    async function requestAll() {
      if (!permission?.granted) await requestPermission();
      if (!micPermission?.granted) await requestMicPermission();
    }
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>
          Camera and microphone access is required to record messages.
        </Text>
        <Button title="Grant Permission" onPress={requestAll} />
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.cancelLink}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function handleChunkReady(event: ChunkReadyEvent) {
    console.log(`[Record] Chunk ${event.index} ready: ${event.uri}`);
    uploaderRef.current?.enqueueChunk(event.index, event.uri);
  }

  function handleRecorderError(message: string) {
    console.error('[Record] Recorder error:', message);
    setErrorMessage(message);
    setStatus('error');
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function handleStartRecording() {
    if (!adapter || !user) {
      setErrorMessage('Not ready — please try again.');
      return;
    }

    const messageId = Crypto.randomUUID();
    messageIdRef.current = messageId;
    startTimeRef.current = Date.now();

    await saveDraft({
      message_id: messageId,
      thread_id: threadId,
      group_id: groupId ?? null,
      started_at: new Date().toISOString(),
      chunks_uploaded: [],
      status: 'recording',
    });

    uploaderRef.current = new ChunkUploader(adapter, {
      messageId,
      threadId,
      groupId: groupId ?? null,
    });

    setStatus('recording');
    setIsRecording(true);
    setElapsedSeconds(0);
    setErrorMessage(null);

    // Elapsed timer
    const start = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    try {
      await recorderRef.current?.startRecording();
    } catch (err) {
      console.error('startRecording failed:', err);
      setErrorMessage('Failed to start recording.');
      setStatus('error');
      setIsRecording(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }

  async function handleStopRecording() {
    if (status !== 'recording') return;
    setStatus('stopping');
    setIsRecording(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      await recorderRef.current?.stopRecording();
    } catch (err) {
      console.error('stopRecording failed:', err);
    }

    await finalize();
  }

  async function finalize() {
    const uploader = uploaderRef.current;
    const messageId = messageIdRef.current;
    if (!uploader || !user) return;

    try {
      setStatus('uploading');
      await updateDraftStatus(messageId, 'uploading');

      const uploadedChunks = await uploader.waitForAll();
      const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1000);

      setStatus('finalizing');
      await uploader.finalize(uploadedChunks, durationSeconds, user.email);

      setStatus('done');
      router.back();
    } catch (err) {
      console.error('Finalize failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Upload failed: ${msg}`);
      setStatus('error');
    }
  }

  if (status === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{errorMessage}</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isUploading = status === 'uploading' || status === 'finalizing';

  return (
    <View style={styles.container}>
      <SeamlessRecorderView
        ref={recorderRef}
        style={StyleSheet.absoluteFillObject}
        facing="front"
        videoQuality="480p"
        onChunkReady={handleChunkReady}
        onError={handleRecorderError}
      />

      <View style={styles.overlay}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={status === 'idle' ? () => router.back() : undefined}
            disabled={status !== 'idle'}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>

          {isRecording && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.timerText}>{formatDuration(elapsedSeconds)}</Text>
            </View>
          )}
        </View>

        {/* Bottom controls */}
        <View style={styles.bottomBar}>
          {isUploading ? (
            <View style={styles.uploadingContainer}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.uploadingText}>
                {status === 'finalizing' ? 'Finalizing...' : 'Uploading...'}
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
              onPress={isRecording ? handleStopRecording : handleStartRecording}
              disabled={status === 'stopping'}
            >
              <View
                style={[
                  styles.recordBtnInner,
                  isRecording && styles.recordBtnInnerActive,
                ]}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 56,
    paddingHorizontal: 24,
  },
  cancelText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  timerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  bottomBar: { alignItems: 'center', paddingBottom: 56 },
  recordBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnActive: { borderColor: '#FF3B30' },
  recordBtnInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FF3B30',
  },
  recordBtnInnerActive: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#FF3B30',
  },
  uploadingContainer: { alignItems: 'center', gap: 8 },
  uploadingText: { color: '#fff', fontSize: 14 },
  permissionText: { color: '#fff', textAlign: 'center', padding: 32, fontSize: 16 },
  cancelLink: { color: '#aaa', fontSize: 16, marginTop: 16 },
  errorText: { color: '#fff', textAlign: 'center', padding: 32, fontSize: 16 },
  button: {
    backgroundColor: '#fff',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
});
