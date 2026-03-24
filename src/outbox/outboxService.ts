import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../shared/constants';
import { GoogleDriveAdapter } from '../storage/GoogleDriveAdapter';
import { User } from '../shared/types';

/**
 * Ensure the user's outbox is initialized in Drive.
 * Safe to call on every app launch.
 * Returns the public URL of the user's outbox.json.
 */
export async function initializeOutbox(user: User): Promise<string> {
  const adapter = new GoogleDriveAdapter({
    userSub: user.sub,
    userEmail: user.email,
    userName: user.name,
    accessToken: user.accessToken,
  });

  return adapter.initialize();
}

/**
 * Returns the cached public URL for the user's outbox.json.
 * Returns null if not yet initialized.
 */
export async function getMyOutboxUrl(userSub: string): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEYS.driveOutboxPublicUrl(userSub));
}
