# Off My Chest

Async video messages, stored on your Google Drive.

Off My Chest is a peer-to-peer video messaging app. Record short video messages for friends and family — they're uploaded to your Google Drive and shared via public manifest URLs. No central server stores your data.

## How It Works

Each user has a public `outbox.json` file on their Google Drive. When you record a message, it's chunked, uploaded, and added to your outbox. Your contacts poll your outbox to discover new messages. Video chunks stream directly from Drive.

**Adding contacts** works via QR codes — scan a friend's code (or open their deep link) to exchange outbox URLs.

## Features

- **Chunked video recording** — records in ~4-second MP4 chunks uploaded in parallel, so recipients can start watching before you finish recording
- **Seamless playback** — chunks play back-to-back with no gaps via a custom native player (ExoPlayer on Android, AVQueuePlayer on iOS)
- **Live streaming** — recipients see your video appear in real-time as you record, with new chunks appended to the player
- **Watch tracking** — tracks which videos you've watched, partially watched, or haven't seen yet
- **Auto-play** — opening a conversation auto-plays from where you left off, then advances through unwatched videos
- **Resume** — partially watched videos resume from the last chunk you were on
- **Google Drive storage** — all data lives on your own Drive; the app just coordinates access
- **QR contact exchange** — add friends by scanning a QR code or opening a deep link
- **Cross-platform** — Android and iOS via Expo with custom native modules

## Tech Stack

- **Expo SDK 54** / React Native 0.81 / React 19
- **expo-router** for file-based navigation with typed routes
- **@react-native-google-signin** for native Google OAuth
- **Custom Expo native module** (`seamless-recorder`) for chunked recording and gapless playback
- **Google Drive REST API** for storage (no backend server)
- **TypeScript** throughout

## Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- For Android: Android Studio with SDK 26+ (API level 26 required for seamless chunk recording)
- For iOS: Xcode 15+ with CocoaPods
- A Google Cloud project with OAuth 2.0 credentials

## Environment Setup

1. Copy the example env file:

   ```bash
   cp .env.example .env
   ```

2. Create OAuth 2.0 Client IDs at [Google Cloud Console](https://console.cloud.google.com/apis/credentials). You need three:

   | Type | Details |
   |------|---------|
   | **iOS** | Bundle ID: `com.pnwtechexperts.offmychest` |
   | **Android** | Package: `com.pnwtechexperts.offmychest`, register your debug + release SHA-1 fingerprints |
   | **Web** | Needed for `webClientId` in Google Sign-In config |

3. Enable the **Google Drive API** in your Cloud project.

4. Fill in your `.env`:

   ```env
   EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS=your-ios-client-id.apps.googleusercontent.com
   EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID=your-android-client-id.apps.googleusercontent.com
   EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB=your-web-client-id.apps.googleusercontent.com
   ```

## Build & Run

```bash
# Install dependencies
npm install

# Start the dev server
npx expo start

# Run on Android
npx expo run:android

# Run on iOS (requires prebuild for native modules)
npx expo prebuild --platform ios
npx expo run:ios
```

The custom native module (`modules/seamless-recorder`) requires a dev client build — Expo Go is not supported.

## Project Structure

```
app/                          Expo Router screens
  (auth)/index.tsx            Google Sign-in
  (app)/
    conversations/            Conversation list + thread view
      [threadId]/play.tsx     Video player (fullscreen modal)
      [threadId]/record.tsx   Video recorder (fullscreen modal)
    contacts/                 Contact list + QR scanner
    settings/                 User settings

src/                          Core business logic
  auth/                       Google OAuth provider + token management
  contacts/                   Contact persistence (AsyncStorage)
  messages/                   Watch state, playlist, conversation polling
  recording/                  Chunked recorder, chunk uploader, drafts
  storage/                    Google Drive adapter + outbox management
  shared/                     Types, constants, error classes

modules/seamless-recorder/    Custom Expo native module
  src/                        TypeScript wrappers
  android/                    Kotlin — Camera2 + ExoPlayer
  ios/                        Swift — AVFoundation + AVQueuePlayer
```

## Architecture

```
┌─────────────┐    poll outbox.json     ┌─────────────┐
│   Device A  │ ◄─────────────────────► │   Device B  │
│             │                         │             │
│  Google     │    stream chunks        │  Google     │
│  Drive A    │ ──────────────────────► │  Drive B    │
└─────────────┘                         └─────────────┘
```

- **No central server** — outboxes and video chunks live on each user's Google Drive
- **Outbox polling** — contacts' outboxes are fetched every 30 seconds
- **Progressive upload** — manifest published after first chunk, updated as more upload
- **Public URLs** — Drive files are shared publicly so contacts can read without auth
