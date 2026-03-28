/**
 * Registers an expo-background-fetch task that polls for new messages.
 * The OS controls actual scheduling — minimum interval is ~15 minutes
 * on both Android and iOS. Foreground polling supplements this.
 */

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

import { checkForNewMessages } from './notificationService';

export const BACKGROUND_FETCH_TASK = 'CHECK_NEW_MESSAGES';

// Define the task at module load time (must be top-level, not inside a function)
TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    await checkForNewMessages();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundFetch(): Promise<void> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      return;
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
        minimumInterval: 5 * 60, // 5 minutes (OS may enforce 15 min minimum)
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch (err) {
    console.warn('[BackgroundFetch] Registration failed:', err);
  }
}
