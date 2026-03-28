import { Stack } from 'expo-router';
import React from 'react';

export default function ConversationsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Conversations' }} />
      <Stack.Screen name="new" options={{ title: 'New Conversation' }} />
      <Stack.Screen name="join" options={{ title: 'Join Conversation' }} />
      <Stack.Screen name="[convId]/index" options={{ title: 'Conversation' }} />
      <Stack.Screen
        name="[convId]/record"
        options={{
          title: 'Record',
          presentation: 'fullScreenModal',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="[convId]/play"
        options={{
          title: '',
          presentation: 'fullScreenModal',
          headerShown: false,
        }}
      />
    </Stack>
  );
}
