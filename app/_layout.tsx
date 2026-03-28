import { Slot, useRouter, useSegments } from 'expo-router';
import React, { useEffect, useRef } from 'react';

import { GoogleAuthProvider, useAuth } from '../src/auth/GoogleAuthProvider';
import { initializeOutbox } from '../src/outbox/outboxService';
import { getIncompleteDrafts, clearDraft } from '../src/recording/draftStore';

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
      // Local chunk files no longer exist after an app restart, so resumption
      // isn't possible. Silently clear any stale drafts.
      await Promise.all(drafts.map((d) => clearDraft(d.message_id)));
    } catch (err) {
      console.error('Draft check failed:', err);
    }
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
