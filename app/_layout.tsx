import { Slot, useRouter, useSegments } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { GoogleAuthProvider, useAuth } from '../src/auth/GoogleAuthProvider';
import { initializeOutbox } from '../src/outbox/outboxService';
import { getIncompleteDrafts, clearDraft } from '../src/recording/draftStore';
import { DraftMessage } from '../src/shared/types';

function AuthGate() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const initDone = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)');
    } else if (user && inAuthGroup) {
      router.replace('/(app)/conversations');
    }
  }, [user, isLoading, segments]);

  // Initialize Drive + check for orphaned drafts on first authenticated load
  useEffect(() => {
    if (!user || initDone.current) return;
    initDone.current = true;

    initializeOutbox(user).catch((err) => {
      console.error('Failed to initialize outbox:', err);
    });

    checkForOrphanedDrafts();
  }, [user]);

  async function checkForOrphanedDrafts() {
    try {
      const drafts = await getIncompleteDrafts();
      if (drafts.length === 0) return;

      // Show one prompt for all orphaned drafts (rare to have more than one)
      const count = drafts.length;
      const label = count === 1
        ? `You have an unsent video message`
        : `You have ${count} unsent video messages`;

      Alert.alert(
        label,
        'Would you like to discard it?',
        [
          {
            text: 'Keep for now',
            style: 'cancel',
          },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => discardDrafts(drafts),
          },
        ],
      );
    } catch (err) {
      console.error('Draft check failed:', err);
    }
  }

  async function discardDrafts(drafts: DraftMessage[]) {
    await Promise.all(drafts.map((d) => clearDraft(d.message_id)));
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <GoogleAuthProvider>
      <AuthGate />
    </GoogleAuthProvider>
  );
}
