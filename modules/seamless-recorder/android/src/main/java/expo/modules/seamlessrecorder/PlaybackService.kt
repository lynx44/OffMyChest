package expo.modules.seamlessrecorder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat as MediaNotificationCompat
import com.google.android.exoplayer2.Player

class PlaybackService : Service() {

    companion object {
        private const val TAG = "PlaybackService"
        private const val CHANNEL_ID = "offmychest_playback"
        private const val NOTIFICATION_ID = 1001
        private const val ACTION_PLAY = "expo.modules.seamlessrecorder.PLAY"
        private const val ACTION_PAUSE = "expo.modules.seamlessrecorder.PAUSE"
        private const val ACTION_STOP = "expo.modules.seamlessrecorder.STOP"

        @Volatile var currentPlayer: Player? = null
        private var instance: PlaybackService? = null

        fun start(context: Context) {
            val intent = Intent(context, PlaybackService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, PlaybackService::class.java))
        }

        fun onPlayerChanged() {
            instance?.attachPlayer()
        }
    }

    private var mediaSession: MediaSessionCompat? = null
    private var playerListener: Player.Listener? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        setupMediaSession()
        // Post initial notification immediately to satisfy foreground requirement
        startForeground(NOTIFICATION_ID, buildNotification(false))
        Log.d(TAG, "Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY -> currentPlayer?.play()
            ACTION_PAUSE -> currentPlayer?.pause()
            ACTION_STOP -> {
                currentPlayer?.pause()
                stopSelf()
                return START_NOT_STICKY
            }
        }
        attachPlayer()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        detachPlayer()
        mediaSession?.isActive = false
        mediaSession?.release()
        mediaSession = null
        instance = null
        Log.d(TAG, "Service destroyed")
        super.onDestroy()
    }

    fun attachPlayer() {
        detachPlayer()
        val player = currentPlayer ?: return
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                updateNotification(isPlaying)
                updateMediaSessionState(isPlaying)
            }
            override fun onPlaybackStateChanged(state: Int) {
                val isPlaying = player.isPlaying
                updateNotification(isPlaying)
                updateMediaSessionState(isPlaying)
            }
        }
        playerListener = listener
        player.addListener(listener)
        updateNotification(player.isPlaying)
        updateMediaSessionState(player.isPlaying)
        mediaSession?.isActive = true
    }

    private fun detachPlayer() {
        playerListener?.let { currentPlayer?.removeListener(it) }
        playerListener = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Video Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Controls for video message playback"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun setupMediaSession() {
        mediaSession = MediaSessionCompat(this, "OffMyChest").apply {
            setMetadata(
                MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, "Off My Chest")
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "Video Message")
                    .build()
            )
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() { currentPlayer?.play() }
                override fun onPause() { currentPlayer?.pause() }
                override fun onStop() {
                    currentPlayer?.pause()
                    stopSelf()
                }
            })
            isActive = true
        }
    }

    private fun updateMediaSessionState(isPlaying: Boolean) {
        val state = if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        val position = currentPlayer?.currentPosition ?: 0L
        mediaSession?.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or
                    PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_PLAY_PAUSE or
                    PlaybackStateCompat.ACTION_STOP
                )
                .setState(state, position, if (isPlaying) 1f else 0f)
                .build()
        )
    }

    private fun updateNotification(isPlaying: Boolean) {
        val notification = buildNotification(isPlaying)
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, notification)
    }

    private fun buildNotification(isPlaying: Boolean): Notification {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = if (openIntent != null) {
            PendingIntent.getActivity(this, 0, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        } else null

        val playPauseAction = if (isPlaying) {
            NotificationCompat.Action.Builder(
                android.R.drawable.ic_media_pause, "Pause",
                buildActionIntent(ACTION_PAUSE)
            ).build()
        } else {
            NotificationCompat.Action.Builder(
                android.R.drawable.ic_media_play, "Play",
                buildActionIntent(ACTION_PLAY)
            ).build()
        }

        val stopAction = NotificationCompat.Action.Builder(
            android.R.drawable.ic_delete, "Stop",
            buildActionIntent(ACTION_STOP)
        ).build()

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Off My Chest")
            .setContentText(if (isPlaying) "Playing video message" else "Paused")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setOngoing(isPlaying)
            .addAction(playPauseAction)
            .addAction(stopAction)
            .setStyle(
                MediaNotificationCompat.MediaStyle()
                    .setMediaSession(mediaSession?.sessionToken)
                    .setShowActionsInCompactView(0)
            )
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
    }

    private fun buildActionIntent(action: String): PendingIntent {
        val intent = Intent(this, PlaybackService::class.java).apply {
            this.action = action
        }
        return PendingIntent.getService(this, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}
