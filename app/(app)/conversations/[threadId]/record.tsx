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
import { saveDraft, updateDraftStatus, clearDraft } from '../../../../src/recording/draftStore';
import { useStorageAdapter } from '../../../../src/storage/useStorageAdapter';
import { RecordingStatus } from '../../../../src/recording/recordingTypes';
import {
  SeamlessRecorderView,
  SeamlessRecorderRef,
  ChunkReadyEvent,
} from '../../../../modules/seamless-recorder/src';
import { NotesOverlay, NotesToggleButton } from '../../../../src/notes/NotesOverlay';
import { getNotes } from '../../../../src/notes/notesStore';

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
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notesVisible, setNotesVisible] = useState(false);
  const [hasNotes, setHasNotes] = useState(false);
  const [sessionId, setSessionId] = useState(() => Crypto.randomUUID());

  /** Number of background upload/finalize tasks in progress */
  const [bgUploads, setBgUploads] = useState(0);

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

  // Check if thread has notes
  useEffect(() => {
    if (threadId) {
      getNotes(threadId).then((n) => setHasNotes(n.length > 0));
    }
  }, [threadId]);

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

    const messageId = sessionId;
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
    }, user.email);

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
      setIsRecording(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }

  async function handleStopRecording() {
    if (!isRecording) return;
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

    // Wait for the final onChunkReady event to cross the native→JS bridge
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Capture references for background work
    const uploader = uploaderRef.current;
    const messageId = messageIdRef.current;
    const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1000);
    const email = user?.email ?? '';

    // Reset immediately — each recording has its own directory (via sessionId),
    // so the next recording's files can never overwrite the previous one's.
    uploaderRef.current = null;
    messageIdRef.current = '';
    setElapsedSeconds(0);
    // Generate a new sessionId for the next recording
    setSessionId(Crypto.randomUUID());

    // Run entire upload + finalize in background
    if (uploader && email) {
      setBgUploads((n) => n + 1);
      finalizeInBackground(uploader, messageId, durationSeconds, email);
    }
  }

  async function finalizeInBackground(
    uploader: ChunkUploader,
    messageId: string,
    durationSeconds: number,
    email: string,
  ) {
    try {
      await updateDraftStatus(messageId, 'uploading');
      const uploadedChunks = await uploader.waitForAll();
      await uploader.finalize(uploadedChunks, durationSeconds, email);
      console.log(`[Record] Background finalize complete for ${messageId}`);
    } catch (err: any) {
      if (err?.status === 404) {
        // Video was deleted before finalization completed — clean up the draft and move on
        console.log(`[Record] Video ${messageId} was deleted before finalize — clearing draft`);
        await clearDraft(messageId).catch(() => {});
      } else {
        console.error(`[Record] Background finalize failed for ${messageId}:`, err);
      }
    } finally {
      setBgUploads((n) => n - 1);
    }
  }

  if (errorMessage && !isRecording) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{errorMessage}</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SeamlessRecorderView
        ref={recorderRef}
        style={StyleSheet.absoluteFillObject}
        facing="front"
        videoQuality="480p"
        sessionId={sessionId}
        onChunkReady={handleChunkReady}
        onError={handleRecorderError}
      />

      <View style={styles.overlay}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.cancelText}>
              {isRecording ? 'Cancel' : 'Done'}
            </Text>
          </TouchableOpacity>

          <View style={styles.topRight}>
            <NotesToggleButton
              visible={notesVisible}
              onToggle={() => setNotesVisible((v) => !v)}
              hasNotes={hasNotes}
            />
            {isRecording && (
              <View style={styles.recordingIndicator}>
                <View style={styles.recordingDot} />
                <Text style={styles.timerText}>{formatDuration(elapsedSeconds)}</Text>
              </View>
            )}
          </View>
        </View>

        <NotesOverlay
          threadId={threadId}
          visible={notesVisible}
          onToggle={() => setNotesVisible((v) => !v)}
        />

        {/* Background upload indicator */}
        {bgUploads > 0 && !isRecording && (
          <View style={styles.bgUploadBanner}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.bgUploadText}>
              Sending{bgUploads > 1 ? ` (${bgUploads})` : ''}...
            </Text>
          </View>
        )}

        {/* Bottom controls */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
            onPress={isRecording ? handleStopRecording : handleStartRecording}
          >
            <View
              style={[
                styles.recordBtnInner,
                isRecording && styles.recordBtnInnerActive,
              ]}
            />
          </TouchableOpacity>
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
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  bgUploadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  bgUploadText: { color: '#fff', fontSize: 13 },
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
