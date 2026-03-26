import AsyncStorage from '@react-native-async-storage/async-storage';

export interface WatchState {
  /** true if the video was watched to the end */
  completed: boolean;
  /** playback position — packed format (windowIndex * 1_000_000 + windowOffsetMs) */
  positionMs: number;
  /** elapsed seconds at time of save (for display) */
  elapsedSeconds?: number;
  /** ISO 8601 timestamp of last watch (partial or complete) */
  lastWatchedAt: string;
}

const KEY_PREFIX = 'watch:';

function key(manifestUrl: string): string {
  return `${KEY_PREFIX}${manifestUrl}`;
}

export async function getWatchState(manifestUrl: string): Promise<WatchState | null> {
  const raw = await AsyncStorage.getItem(key(manifestUrl));
  if (!raw) return null;
  return JSON.parse(raw);
}

/** Batch-fetch watch states for multiple manifest URLs. Returns a Map keyed by URL. */
export async function getWatchStates(manifestUrls: string[]): Promise<Map<string, WatchState>> {
  const keys = manifestUrls.map(key);
  const pairs = await AsyncStorage.multiGet(keys);
  const result = new Map<string, WatchState>();
  for (let i = 0; i < pairs.length; i++) {
    const raw = pairs[i][1];
    if (raw) result.set(manifestUrls[i], JSON.parse(raw));
  }
  return result;
}

export async function saveWatchState(
  manifestUrl: string,
  state: Omit<WatchState, 'lastWatchedAt'>,
): Promise<void> {
  const full: WatchState = {
    ...state,
    lastWatchedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(key(manifestUrl), JSON.stringify(full));
}
