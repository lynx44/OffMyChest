import AsyncStorage from '@react-native-async-storage/async-storage';

export interface WatchState {
  /** true if the video was watched to the end */
  completed: boolean;
  /** playback position in ms (0 if completed) */
  positionMs: number;
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
