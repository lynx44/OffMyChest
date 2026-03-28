import { GoogleDriveAdapter } from '../storage/GoogleDriveAdapter';
import { User } from '../shared/types';

/**
 * Ensure the user's Drive folder exists.
 * Safe to call on every app launch.
 */
export async function initializeOutbox(user: User): Promise<void> {
  const adapter = new GoogleDriveAdapter({
    userSub: user.sub,
    userEmail: user.email,
    userName: user.name,
    accessToken: user.accessToken,
  });

  await adapter.initialize();
}
