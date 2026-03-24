import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function ConversationsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.empty}>No conversations yet.</Text>
      <Text style={styles.hint}>Add a contact to get started.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  empty: {
    fontSize: 18,
    fontWeight: '600',
  },
  hint: {
    fontSize: 14,
    color: '#666',
  },
});
