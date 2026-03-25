import { Video, AVPlaybackStatus, ResizeMode } from 'expo-av';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { fetchPublicJson } from '../../../../src/storage/driveApi';
import { MessageManifest } from '../../../../src/shared/types';

/** Reverse base64url → original URL */
function decodeParam(encoded: string): string {
  const padded = encoded + '==='.slice((encoded.length + 3) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type LoadState = 'loading' | 'playing' | 'error';

export default function PlayScreen() {
  const { manifest: encodedManifest } = useLocalSearchParams<{ manifest: string }>();
  const router = useRouter();

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [chunks, setChunks] = useState<string[]>([]);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);

  const videoRef = useRef<Video>(null);

  // Fetch manifest and start playback
  useEffect(() => {
    if (!encodedManifest) {
      setError('No manifest URL provided');
      setLoadState('error');
      return;
    }

    const manifestUrl = decodeParam(encodedManifest);
    fetchPublicJson<MessageManifest>(manifestUrl)
      .then((manifest) => {
        if (!manifest.chunks || manifest.chunks.length === 0) {
          throw new Error('Message has no video chunks');
        }
        setChunks(manifest.chunks);
        setTotalDuration(manifest.duration_seconds);
        setChunkIndex(0);
        setLoadState('playing');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load message');
        setLoadState('error');
      });
  }, [encodedManifest]);

  // When chunkIndex advances, load the next chunk into the player
  useEffect(() => {
    if (loadState !== 'playing' || chunks.length === 0) return;
    const uri = chunks[chunkIndex];
    if (!uri) return;
    videoRef.current?.loadAsync({ uri }, { shouldPlay: true }, false);
  }, [chunkIndex, chunks, loadState]);

  function handlePlaybackStatus(status: AVPlaybackStatus) {
    if (!status.isLoaded) return;
    if (status.didJustFinish) {
      if (chunkIndex < chunks.length - 1) {
        setChunkIndex((i) => i + 1);
      }
      // Last chunk — stay on the final frame (don't auto-close)
    }
  }

  if (loadState === 'loading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#fff" size="large" />
        <Text style={styles.loadingText}>Loading message...</Text>
      </View>
    );
  }

  if (loadState === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
          <Text style={styles.closeBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isLastChunk = chunkIndex === chunks.length - 1;

  return (
    <View style={styles.container}>
      <Video
        ref={videoRef}
        style={StyleSheet.absoluteFillObject}
        resizeMode={ResizeMode.CONTAIN}
        onPlaybackStatusUpdate={handlePlaybackStatus}
        useNativeControls={false}
      />

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>

        <Text style={styles.chunkIndicator}>
          {chunks.length > 1 ? `${chunkIndex + 1} / ${chunks.length}` : ''}
        </Text>

        <Text style={styles.durationText}>{formatDuration(totalDuration)}</Text>
      </View>

      {/* Progress dots for multi-chunk messages */}
      {chunks.length > 1 && (
        <View style={styles.dotsRow}>
          {chunks.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === chunkIndex && styles.dotActive]}
            />
          ))}
        </View>
      )}

      {/* "Done" overlay on last chunk finish */}
      {isLastChunk && (
        <TouchableOpacity style={styles.doneArea} onPress={() => router.back()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#aaa',
    marginTop: 16,
    fontSize: 15,
  },
  errorText: {
    color: '#fff',
    textAlign: 'center',
    padding: 32,
    fontSize: 15,
  },
  closeBtn: {
    backgroundColor: '#333',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 52,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  closeText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '400',
  },
  chunkIndicator: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
  },
  durationText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  dotsRow: {
    position: 'absolute',
    bottom: 48,
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotActive: {
    backgroundColor: '#fff',
    width: 18,
  },
  doneArea: {
    ...StyleSheet.absoluteFillObject,
  },
});
