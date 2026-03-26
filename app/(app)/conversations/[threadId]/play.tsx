import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { fetchPublicJson } from '../../../../src/storage/driveApi';
import { MessageManifest } from '../../../../src/shared/types';
import { SeamlessPlayerView, SeamlessPlayerRef } from '../../../../modules/seamless-recorder/src';

function decodeParam(encoded: string): string {
  const padded = encoded + '==='.slice((encoded.length + 3) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function PlayScreen() {
  const { manifest: encodedManifest } = useLocalSearchParams<{ manifest: string }>();
  const router = useRouter();

  const [loadState, setLoadState] = useState<'loading' | 'playing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [totalDuration, setTotalDuration] = useState(0);
  const [chunks, setChunks] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const playerRef = useRef<SeamlessPlayerRef>(null);

  const togglePlayPause = useCallback(() => {
    if (paused) {
      playerRef.current?.play();
    } else {
      playerRef.current?.pause();
    }
    setPaused((p) => !p);
  }, [paused]);

  useEffect(() => {
    if (!encodedManifest) {
      setError('No manifest URL provided');
      setLoadState('error');
      return;
    }

    const manifestUrl = decodeParam(encodedManifest);

    fetchPublicJson<MessageManifest>(manifestUrl)
      .then((manifest) => {
        if (!manifest.chunks?.length) throw new Error('Message has no video chunks');
        setTotalDuration(manifest.duration_seconds);
        setChunks(manifest.chunks);
        setLoadState('playing');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load message');
        setLoadState('error');
      });
  }, [encodedManifest]);

  return (
    <View style={styles.container}>
      {chunks.length > 0 && (
        <Pressable style={StyleSheet.absoluteFillObject} onPress={togglePlayPause}>
          <SeamlessPlayerView
            ref={playerRef}
            style={StyleSheet.absoluteFillObject}
            chunks={chunks}
            onPlaybackFinished={() => router.back()}
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
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.durationText}>{formatDuration(totalDuration)}</Text>
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
  closeText: { color: '#fff', fontSize: 20 },
  durationText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontVariant: ['tabular-nums'] },
});
