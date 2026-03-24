import { Stack } from 'expo-router';
import React from 'react';

export default function ConversationsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Conversations' }} />
      <Stack.Screen name="[threadId]/index" options={{ title: 'Conversation' }} />
      <Stack.Screen
        name="[threadId]/record"
        options={{
          title: 'Record',
          presentation: 'fullScreenModal',
          headerShown: false,
        }}
      />
    </Stack>
  );
}
