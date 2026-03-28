import { Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

export default function AppLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen
        name="conversations"
        options={{
          title: 'Conversations',
          tabBarLabel: 'Conversations',
          tabBarIcon: () => <Text>💬</Text>,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
          tabBarIcon: () => <Text>⚙️</Text>,
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          href: null, // hidden from tab bar but routes still work
        }}
      />
    </Tabs>
  );
}
