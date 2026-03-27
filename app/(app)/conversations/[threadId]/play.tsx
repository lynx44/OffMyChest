import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { fetchPublicJson } from '../../../../src/storage/driveApi';
import { MessageManifest } from '../../../../src/shared/types';
import { SeamlessPlayerView, SeamlessPlayerRef, startBackgroundPlayback, stopBackgroundPlayback } from '../../../../modules/seamless-recorder/src';
import { getPlaylist } from '../../../../src/messages/playlistStore';
import { getWatchState, getWatchStates, saveWatchState } from '../../../../src/messages/watchStateStore';
import { NotesOverlay, NotesToggleButton } from '../../../../src/notes/NotesOverlay';
import { getNotes } from '../../../../src/notes/notesStore';

function decodeParam(encoded: string): string {
  const padded = encoded + '==='.slice((encoded.length + 3) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface VideoBoundary {
  url: string;
  startIdx: number;
  count: number;
  duration: number;
}

const LIVE_POLL_INTERVAL_MS = 3000;

export default function PlayScreen() {
  const { threadId, manifest: encodedManifest } = useLocalSearchParams<{ threadId: string; manifest: string }>();
  const router = useRouter();

  const initialManifestUrl = encodedManifest ? decodeParam(encodedManifest) : '';

  const [loadState, setLoadState] = useState<'loading' | 'playing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [totalDuration, setTotalDuration] = useState(0);
  const [chunks, setChunks] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [startPosition, setStartPosition] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [notesVisible, setNotesVisible] = useState(false);
  const [hasNotes, setHasNotes] = useState(false);
  const [scrubFraction, setScrubFraction] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const scrubBarWidthRef = useRef(0);
  const scrubBarPageXRef = useRef(0);
  const scrubTrackRef = useRef<View>(null);
  const speedRef = useRef(1);
  const pausedRef = useRef(false);
  const playerRef = useRef<SeamlessPlayerRef>(null);
  const manifestUrlRef = useRef('');
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadedChunkCountRef = useRef(0);
  const elapsedOffsetRef = useRef(0);
  const isLiveRef = useRef(false);
  const liveManifestUrlRef = useRef('');
  /** Tick counter for periodic position save (every 10 ticks × 500ms = 5s) */
  const saveTickRef = useRef(0);

  /** Tracks which chunks belong to which video in the concatenated playlist */
  const videoBoundariesRef = useRef<VideoBoundary[]>([]);
  /** Videos already marked completed during this playback session */
  const completedInSessionRef = useRef<Set<string>>(new Set());
  /** Last detected video index (for boundary crossing detection) */
  const lastVideoIdxRef = useRef(0);

  const SPEEDS = [1, 1.5, 2, 3];
  const cycleSpeed = useCallback(() => {
    const nextIdx = (SPEEDS.indexOf(speed) + 1) % SPEEDS.length;
    const next = SPEEDS[nextIdx];
    speedRef.current = next;
    setSpeed(next);
    playerRef.current?.setSpeed(next);
  }, [speed]);

  const togglePlayPause = useCallback(() => {
    if (pausedRef.current) {
      playerRef.current?.play();
    } else {
      playerRef.current?.pause();
    }
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }, []);

  /** Find which video boundary contains a given chunk window index */
  const findBoundary = useCallback((windowIdx: number): { boundary: VideoBoundary; videoIdx: number } | null => {
    const boundaries = videoBoundariesRef.current;
    for (let i = 0; i < boundaries.length; i++) {
      const b = boundaries[i];
      if (windowIdx >= b.startIdx && windowIdx < b.startIdx + b.count) {
        return { boundary: b, videoIdx: i };
      }
    }
    return null;
  }, []);

  /** Save current position as partial watch state, adjusted for multi-video playlist */
  const savePartialProgress = useCallback(async () => {
    if (!playerRef.current) return;
    try {
      const positionMs = await playerRef.current.getPositionMs();
      if (positionMs <= 0) return;

      const windowIdx = Math.floor(positionMs / 1_000_000);
      const windowOffset = positionMs % 1_000_000;
      const result = findBoundary(windowIdx);
      if (!result) return;

      const { boundary } = result;
      // Position relative to this video (not the concatenated playlist)
      const relativeWindowIdx = windowIdx - boundary.startIdx;
      const relativePositionMs = relativeWindowIdx * 1_000_000 + windowOffset;
      const chunkDurMs = boundary.count > 0 ? (boundary.duration * 1000) / boundary.count : 0;
      const elapsedSec = Math.floor((relativeWindowIdx * chunkDurMs + windowOffset) / 1000);

      await saveWatchState(boundary.url, {
        completed: false,
        positionMs: relativePositionMs,
        elapsedSeconds: elapsedSec,
      });
    } catch {}
  }, [findBoundary]);

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
          console.log('[Live] Recording complete, stopping poll');
          setIsLive(false);
          isLiveRef.current = false;
          liveManifestUrlRef.current = '';
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

  const stopLivePolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      stopLivePolling();
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [stopLivePolling]);

  // Check if thread has notes
  useEffect(() => {
    if (threadId) {
      getNotes(threadId).then((n) => setHasNotes(n.length > 0));
    }
  }, [threadId]);

  // Start/stop background playback service
  useEffect(() => {
    if (loadState === 'playing') {
      startBackgroundPlayback().catch(() => {});
    }
    return () => {
      stopBackgroundPlayback().catch(() => {});
    };
  }, [loadState]);

  // Re-apply playback speed when playing starts
  useEffect(() => {
    if (loadState === 'playing' && speedRef.current !== 1) {
      playerRef.current?.setSpeed(speedRef.current);
    }
  }, [loadState]);

  // Poll native player for elapsed time + detect video boundary crossings
  useEffect(() => {
    if (loadState !== 'playing') return;
    elapsedTimerRef.current = setInterval(async () => {
      if (paused) return;
      try {
        const posMs = await playerRef.current?.getPositionMs();
        if (posMs == null) return;

        const windowIdx = Math.floor(posMs / 1_000_000);
        const windowOffset = posMs % 1_000_000;
        const result = findBoundary(windowIdx);

        if (result) {
          const { boundary, videoIdx } = result;

          // Detect boundary crossing — mark previous videos as completed
          if (videoIdx > lastVideoIdxRef.current) {
            for (let i = lastVideoIdxRef.current; i < videoIdx; i++) {
              const prevUrl = videoBoundariesRef.current[i]?.url;
              if (prevUrl && !completedInSessionRef.current.has(prevUrl)) {
                completedInSessionRef.current.add(prevUrl);
                saveWatchState(prevUrl, { completed: true, positionMs: 0 }).catch(() => {});
              }
            }
            lastVideoIdxRef.current = videoIdx;
          }

          // Update manifestUrlRef so back-button save targets the right video
          manifestUrlRef.current = boundary.url;

          // Save position every ~5 seconds so it survives unexpected interruptions
          saveTickRef.current += 1;
          if (saveTickRef.current % 10 === 0) {
            const relWindowIdx = windowIdx - boundary.startIdx;
            const chunkDurMs = boundary.count > 0 ? (boundary.duration * 1000) / boundary.count : 0;
            const relativePositionMs = relWindowIdx * 1_000_000 + windowOffset;
            const elapsedSec = Math.floor((relWindowIdx * chunkDurMs + windowOffset) / 1000);
            saveWatchState(boundary.url, {
              completed: false,
              positionMs: relativePositionMs,
              elapsedSeconds: elapsedSec,
            }).catch(() => {});
          }

          // Compute elapsed for current video only
          const relWindowIdx = windowIdx - boundary.startIdx;
          const chunkDurMs = boundary.count > 0 ? (boundary.duration * 1000) / boundary.count : 0;
          const elapsed = Math.floor((relWindowIdx * chunkDurMs + windowOffset) / 1000);
          setElapsedSeconds(elapsed);
          setTotalDuration(boundary.duration);
          if (!isSeeking && boundary.duration > 0) {
            setScrubFraction(elapsed / boundary.duration);
          }
        }
      } catch {}
    }, 500);
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [loadState, paused, isSeeking, findBoundary]);

  // When app returns to foreground, re-sync live video:
  // - restart polling if it was throttled in background
  // - immediately fetch manifest to append any missed chunks
  // - if player reached STATE_ENDED while backgrounded, appendChunks will resume it
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState !== 'active') return;
      if (!isLiveRef.current || !liveManifestUrlRef.current) return;
      try {
        const manifestUrl = liveManifestUrlRef.current;
        console.log('[Live] App foregrounded — re-syncing live manifest');

        // Restart poll timer if it stopped
        if (!pollTimerRef.current) {
          startLivePolling(manifestUrl);
        }

        // Immediately fetch and append any chunks missed while backgrounded
        const manifest = await fetchPublicJson<MessageManifest>(manifestUrl);
        const loaded = loadedChunkCountRef.current;
        if (manifest.chunks.length > loaded) {
          const toAppend = manifest.chunks.slice(loaded);
          console.log(`[Live] Foreground catch-up: appending ${toAppend.length} missed chunks`);
          await playerRef.current?.appendChunks(toAppend);
          loadedChunkCountRef.current = manifest.chunks.length;

          // Update boundary count so position tracking stays accurate
          const b = videoBoundariesRef.current[0];
          if (b) b.count = manifest.chunks.length;
        }

        if (manifest.status === 'complete' || !manifest.status) {
          setIsLive(false);
          isLiveRef.current = false;
          liveManifestUrlRef.current = '';
          setTotalDuration(manifest.duration_seconds);
          stopLivePolling();
        }
      } catch (err) {
        console.warn('[Live] Foreground re-sync failed:', err);
      }
    });
    return () => sub.remove();
  }, [startLivePolling, stopLivePolling]);

  // Handle Android hardware back button
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      savePartialProgress().then(() => router.back());
      return true;
    });
    return () => handler.remove();
  }, [savePartialProgress, router]);

  // Load video(s) — fetches current manifest + all remaining unwatched manifests,
  // concatenates all chunks so the native player can play through everything
  // without needing JS to intervene for auto-advance (critical for background playback).
  useEffect(() => {
    if (!initialManifestUrl) {
      setError('No manifest URL provided');
      setLoadState('error');
      return;
    }

    setLoadState('loading');
    setChunks([]);
    setPaused(false);
    setStartPosition(0);
    setElapsedSeconds(0);
    elapsedOffsetRef.current = 0;
    loadedChunkCountRef.current = 0;
    videoBoundariesRef.current = [];
    completedInSessionRef.current = new Set();
    lastVideoIdxRef.current = 0;
    stopLivePolling();

    manifestUrlRef.current = initialManifestUrl;

    (async () => {
      try {
        const [manifest, watchState] = await Promise.all([
          fetchPublicJson<MessageManifest>(initialManifestUrl),
          getWatchState(initialManifestUrl),
        ]);
        if (!manifest.chunks?.length) throw new Error('Message has no video chunks');

        const live = manifest.status === 'recording';
        setIsLive(live);

        // Handle resume position for the starting video
        if (watchState && !watchState.completed && watchState.positionMs > 0) {
          setStartPosition(watchState.positionMs);
          const windowIndex = Math.floor(watchState.positionMs / 1_000_000);
          const chunkDur = manifest.chunk_duration_seconds
            ?? (manifest.chunks.length > 0 ? manifest.duration_seconds / manifest.chunks.length : 0);
          const offset = Math.floor(windowIndex * chunkDur);
          elapsedOffsetRef.current = offset;
          setElapsedSeconds(offset);
        }

        // Start building the concatenated chunk list
        const allChunks = [...manifest.chunks];
        const boundaries: VideoBoundary[] = [{
          url: initialManifestUrl,
          startIdx: 0,
          count: manifest.chunks.length,
          duration: manifest.duration_seconds,
        }];

        // For non-live videos, pre-fetch all remaining unwatched manifests
        if (!live) {
          const playlist = getPlaylist();
          const currentIdx = playlist.indexOf(initialManifestUrl);
          if (currentIdx >= 0 && currentIdx < playlist.length - 1) {
            const remaining = playlist.slice(currentIdx + 1);
            const states = await getWatchStates(remaining);
            const unwatched = remaining.filter((url) => {
              const ws = states.get(url);
              return !ws || !ws.completed;
            });

            // Fetch all upcoming manifests in parallel
            const upcomingManifests = await Promise.all(
              unwatched.map((url) =>
                fetchPublicJson<MessageManifest>(url).catch(() => null),
              ),
            );

            for (let i = 0; i < unwatched.length; i++) {
              const m = upcomingManifests[i];
              if (!m || !m.chunks?.length || m.status === 'recording') continue;
              boundaries.push({
                url: unwatched[i],
                startIdx: allChunks.length,
                count: m.chunks.length,
                duration: m.duration_seconds,
              });
              allChunks.push(...m.chunks);
            }
          }
        }

        videoBoundariesRef.current = boundaries;
        setTotalDuration(manifest.duration_seconds);
        setChunks(allChunks);
        loadedChunkCountRef.current = allChunks.length;
        setLoadState('playing');

        isLiveRef.current = live;
        liveManifestUrlRef.current = live ? initialManifestUrl : '';

        if (live) {
          startLivePolling(initialManifestUrl);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load message');
        setLoadState('error');
      }
    })();
  }, [initialManifestUrl, startLivePolling, stopLivePolling]);

  /** On source error, try to skip the bad chunk. Shows error screen only if unrecoverable. */
  const handlePlaybackError = useCallback(async (msg: string) => {
    console.warn('[Play] Source error:', msg);
    try {
      const posMs = await playerRef.current?.getPositionMs();
      if (posMs != null) {
        const windowIdx = Math.floor(posMs / 1_000_000);
        const totalChunks = loadedChunkCountRef.current;
        const nextChunk = windowIdx + 1;
        if (nextChunk < totalChunks) {
          console.log(`[Play] Skipping bad chunk ${windowIdx} → seeking to ${nextChunk}`);
          await playerRef.current?.seekToChunk(nextChunk);
          return; // recovered — stay on playing state
        }
      }
    } catch (skipErr) {
      console.warn('[Play] Skip recovery failed:', skipErr);
    }
    setError(msg);
    setLoadState('error');
  }, []);

  const handlePlaybackFinished = useCallback(async () => {
    if (isLive) return;

    // Mark all videos in the playlist as completed
    for (const b of videoBoundariesRef.current) {
      if (!completedInSessionRef.current.has(b.url)) {
        completedInSessionRef.current.add(b.url);
        await saveWatchState(b.url, { completed: true, positionMs: 0 });
      }
    }

    router.back();
  }, [router, isLive]);

  const handleGoBack = useCallback(async () => {
    // Mark any fully-played videos as completed before saving partial progress
    const boundaries = videoBoundariesRef.current;
    for (let i = 0; i < lastVideoIdxRef.current; i++) {
      const url = boundaries[i]?.url;
      if (url && !completedInSessionRef.current.has(url)) {
        completedInSessionRef.current.add(url);
        await saveWatchState(url, { completed: true, positionMs: 0 });
      }
    }
    await savePartialProgress();
    router.back();
  }, [savePartialProgress, router]);

  const skipBy = useCallback(async (deltaSeconds: number) => {
    try {
      const elapsedMs = await playerRef.current?.getElapsedMs() ?? 0;
      const targetMs = Math.max(0, elapsedMs + deltaSeconds * 1000);

      // Walk boundaries to find which video + chunk the target falls in
      const boundaries = videoBoundariesRef.current;
      let accMs = 0;
      for (const boundary of boundaries) {
        const boundaryMs = boundary.duration * 1000;
        if (targetMs <= accMs + boundaryMs || boundary === boundaries[boundaries.length - 1]) {
          const relMs = Math.max(0, targetMs - accMs);
          const chunkDurMs = boundary.count > 0 ? boundaryMs / boundary.count : 0;
          const chunkWithin = chunkDurMs > 0 ? Math.min(Math.floor(relMs / chunkDurMs), boundary.count - 1) : 0;
          const globalWindowIdx = boundary.startIdx + chunkWithin;
          await playerRef.current?.seekToChunk(globalWindowIdx);
          if (pausedRef.current) playerRef.current?.pause();
          return;
        }
        accMs += boundaryMs;
      }
    } catch {}
  }, []);

  const scrubPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        // Capture the track's screen position at the start of each gesture
        scrubTrackRef.current?.measure((_x, _y, _w, _h, pageX) => {
          scrubBarPageXRef.current = pageX;
        });
        setIsSeeking(true);
        const fraction = Math.max(0, Math.min(1, (evt.nativeEvent.pageX - scrubBarPageXRef.current) / (scrubBarWidthRef.current || 1)));
        setScrubFraction(fraction);
      },
      onPanResponderMove: (evt) => {
        const fraction = Math.max(0, Math.min(1, (evt.nativeEvent.pageX - scrubBarPageXRef.current) / (scrubBarWidthRef.current || 1)));
        setScrubFraction(fraction);
      },
      onPanResponderRelease: async (evt) => {
        const fraction = Math.max(0, Math.min(1, (evt.nativeEvent.pageX - scrubBarPageXRef.current) / (scrubBarWidthRef.current || 1)));
        setScrubFraction(fraction);
        setIsSeeking(false);

        // Find current boundary and seek to the right chunk
        const boundary = videoBoundariesRef.current[lastVideoIdxRef.current];
        if (!boundary || boundary.count === 0) return;

        const targetChunk = Math.min(Math.floor(fraction * boundary.count), boundary.count - 1);
        const globalWindowIdx = boundary.startIdx + targetChunk;
        try {
          await playerRef.current?.seekToChunk(globalWindowIdx);
          if (pausedRef.current) playerRef.current?.pause();
        } catch {}
      },
      onPanResponderTerminate: () => {
        setIsSeeking(false);
      },
    }),
  ).current;

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
            onPlaybackError={handlePlaybackError}
            onLiveCaughtUp={() => {
              speedRef.current = 1;
              setSpeed(1);
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
        <>
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
              <NotesToggleButton
                visible={notesVisible}
                onToggle={() => setNotesVisible((v) => !v)}
                hasNotes={hasNotes}
              />
              <TouchableOpacity onPress={cycleSpeed} style={styles.speedBadge}>
                <Text style={styles.speedText}>{speed === 1 ? '1x' : `${speed}x`}</Text>
              </TouchableOpacity>
              <Text style={styles.durationText}>
                {formatDuration(elapsedSeconds)}
                {!isLive && totalDuration > 0 ? ` / ${formatDuration(totalDuration)}` : ''}
              </Text>
            </View>
          </View>
          <NotesOverlay
            threadId={threadId}
            visible={notesVisible}
            onToggle={() => setNotesVisible((v) => !v)}
          />
          {!isLive && totalDuration > 0 && (
            <View style={styles.scrubberContainer}>
              <TouchableOpacity style={styles.skipBtn} onPress={() => skipBy(-10)}>
                <Text style={styles.skipIcon}>↺</Text>
                <Text style={styles.skipLabel}>10</Text>
              </TouchableOpacity>
              <View
                ref={scrubTrackRef}
                style={styles.scrubberTrack}
                onLayout={(e) => { scrubBarWidthRef.current = e.nativeEvent.layout.width; }}
                {...scrubPanResponder.panHandlers}
              >
                <View style={styles.scrubberTrackInner}>
                  <View style={[styles.scrubberFill, { width: `${scrubFraction * 100}%` }]} />
                </View>
                <View
                  style={[
                    styles.scrubberThumb,
                    { transform: [{ translateX: scrubFraction * scrubBarWidthRef.current - 7 }] },
                  ]}
                />
              </View>
              <TouchableOpacity style={styles.skipBtn} onPress={() => skipBy(30)}>
                <Text style={styles.skipIcon}>↻</Text>
                <Text style={styles.skipLabel}>30</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
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
  speedBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  speedText: { color: '#fff', fontSize: 12, fontWeight: '700' },
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
  scrubberContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 36,
    paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 10,
  },
  skipBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    paddingVertical: 4,
  },
  skipIcon: {
    color: '#fff',
    fontSize: 22,
    lineHeight: 24,
  },
  skipLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    marginTop: -2,
  },
  scrubberTrack: {
    height: 56, // large touch target; thumb top = (56 - thumbSize) / 2
    justifyContent: 'center',
  },
  scrubberTrackInner: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
  },
  scrubberFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 4,
    backgroundColor: '#fff',
    borderRadius: 2,
  },
  scrubberThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#fff',
    top: 21, // (56 - 14) / 2 — centers the dot on the 4px bar
    left: 0,
  },
});
