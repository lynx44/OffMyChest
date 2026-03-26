import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { fetchPublicJson } from '../../../../src/storage/driveApi';
import { MessageManifest } from '../../../../src/shared/types';
import { SeamlessPlayerView, SeamlessPlayerRef } from '../../../../modules/seamless-recorder/src';
import { getWatchState, saveWatchState } from '../../../../src/messages/watchStateStore';

function decodeParam(encoded: string): string {
  const padded = encoded + '==='.slice((encoded.length + 3) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const LIVE_POLL_INTERVAL_MS = 3000;

export default function PlayScreen() {
  const { manifest: encodedManifest } = useLocalSearchParams<{ manifest: string }>();
  const router = useRouter();

  const [loadState, setLoadState] = useState<'loading' | 'playing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [totalDuration, setTotalDuration] = useState(0);
  const [chunks, setChunks] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [startPosition, setStartPosition] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const playerRef = useRef<SeamlessPlayerRef>(null);
  const manifestUrlRef = useRef('');
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadedChunkCountRef = useRef(0);

  const togglePlayPause = useCallback(() => {
    if (paused) {
      playerRef.current?.play();
    } else {
      playerRef.current?.pause();
    }
    setPaused((p) => !p);
  }, [paused]);

  /** Save current position as partial watch state */
  const savePartialProgress = useCallback(async () => {
    const url = manifestUrlRef.current;
    if (!url || !playerRef.current) return;
    const positionMs = await playerRef.current.getPositionMs();
    if (positionMs > 0) {
      await saveWatchState(url, { completed: false, positionMs });
    }
  }, []);

  /** Mark as fully watched */
  const saveCompleted = useCallback(async () => {
    const url = manifestUrlRef.current;
    if (!url) return;
    await saveWatchState(url, { completed: true, positionMs: 0 });
  }, []);

  /** Poll manifest for new chunks during live recording */
  const startLivePolling = useCallback((manifestUrl: string) => {
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(async () => {
      try {
        const manifest = await fetchPublicJson<MessageManifest>(manifestUrl);
        const newChunks = manifest.chunks;
        const loaded = loadedChunkCountRef.current;

        if (newChunks.length > loaded) {
          const toAppend = newChunks.slice(loaded);
          console.log(`[Live] Appending ${toAppend.length} new chunks`);
          await playerRef.current?.appendChunks(toAppend);
          loadedChunkCountRef.current = newChunks.length;
        }

        if (manifest.status === 'complete' || !manifest.status) {
          // Recording finished — stop polling
          console.log('[Live] Recording complete, stopping poll');
          setIsLive(false);
          setTotalDuration(manifest.duration_seconds);
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        }
      } catch (err) {
        console.warn('[Live] Poll failed:', err);
      }
    }, LIVE_POLL_INTERVAL_MS);
  }, []);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, []);

  // Poll elapsed time for display
  useEffect(() => {
    if (loadState !== 'playing') return;
    elapsedTimerRef.current = setInterval(async () => {
      if (!playerRef.current) return;
      const ms = await playerRef.current.getElapsedMs();
      setElapsedSeconds(Math.floor(ms / 1000));
    }, 500);
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [loadState]);

  // Handle Android hardware back button
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      savePartialProgress().then(() => router.back());
      return true; // prevent default
    });
    return () => handler.remove();
  }, [savePartialProgress, router]);

  useEffect(() => {
    if (!encodedManifest) {
      setError('No manifest URL provided');
      setLoadState('error');
      return;
    }

    const manifestUrl = decodeParam(encodedManifest);
    manifestUrlRef.current = manifestUrl;

    (async () => {
      try {
        const [manifest, watchState] = await Promise.all([
          fetchPublicJson<MessageManifest>(manifestUrl),
          getWatchState(manifestUrl),
        ]);
        if (!manifest.chunks?.length) throw new Error('Message has no video chunks');

        if (watchState && !watchState.completed && watchState.positionMs > 0) {
          setStartPosition(watchState.positionMs);
        }

        const live = manifest.status === 'recording';
        setIsLive(live);
        setTotalDuration(manifest.duration_seconds);
        setChunks(manifest.chunks);
        loadedChunkCountRef.current = manifest.chunks.length;
        setLoadState('playing');

        if (live) {
          startLivePolling(manifestUrl);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load message');
        setLoadState('error');
      }
    })();
  }, [encodedManifest, startLivePolling]);

  const handlePlaybackFinished = useCallback(async () => {
    if (isLive) return; // Don't exit during live — more chunks may arrive
    await saveCompleted();
    router.back();
  }, [saveCompleted, router, isLive]);

  const handleGoBack = useCallback(async () => {
    await savePartialProgress();
    router.back();
  }, [savePartialProgress, router]);

  return (
    <View style={styles.container}>
      {chunks.length > 0 && (
        <Pressable style={StyleSheet.absoluteFillObject} onPress={togglePlayPause}>
          <SeamlessPlayerView
            ref={playerRef}
            style={StyleSheet.absoluteFillObject}
            chunks={chunks}
            startPosition={startPosition}
            liveMode={isLive}
            onPlaybackFinished={handlePlaybackFinished}
            onPlaybackError={(msg) => {
              setError(msg);
              setLoadState('error');
            }}
          />
        </Pressable>
      )}

      {loadState === 'loading' && (
        <View style={styles.overlay}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      )}

      {loadState === 'error' && (
        <View style={styles.overlay}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
            <Text style={styles.closeBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {loadState === 'playing' && (
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleGoBack}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          <View style={styles.topRight}>
            {isLive && (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
            <Text style={styles.durationText}>
              {formatDuration(elapsedSeconds)}
              {!isLive && totalDuration > 0 ? ` / ${formatDuration(totalDuration)}` : ''}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  loadingText: { color: '#aaa', marginTop: 16, fontSize: 15 },
  errorText: { color: '#fff', textAlign: 'center', padding: 32, fontSize: 15 },
  closeBtn: { backgroundColor: '#333', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  closeBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  topBar: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 52,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 10,
  },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  closeText: { color: '#fff', fontSize: 20 },
  durationText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontVariant: ['tabular-nums'] },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FF3B30',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  liveText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
