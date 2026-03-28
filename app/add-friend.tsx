/**
 * @deprecated Old add-friend deep link. Redirects to conversations.
 */
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { View } from 'react-native';

export default function AddFriendScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/(app)/conversations');
  }, [router]);
  return <View />;
}
