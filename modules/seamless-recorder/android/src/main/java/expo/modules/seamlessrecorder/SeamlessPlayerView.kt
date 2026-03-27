package expo.modules.seamlessrecorder

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.net.Uri
import android.util.Log
import android.view.TextureView
import com.google.android.exoplayer2.DefaultLoadControl
import com.google.android.exoplayer2.ExoPlayer
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.Player
import com.google.android.exoplayer2.source.ConcatenatingMediaSource
import com.google.android.exoplayer2.source.ProgressiveMediaSource
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource
import com.google.android.exoplayer2.upstream.cache.CacheDataSource
import com.google.android.exoplayer2.upstream.cache.LeastRecentlyUsedCacheEvictor
import com.google.android.exoplayer2.upstream.cache.SimpleCache
import com.google.android.exoplayer2.video.VideoSize
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Native ExoPlayer view that plays a list of MP4 chunk URLs seamlessly
 * using ConcatenatingMediaSource. Uses a TextureView with a transform
 * matrix to maintain correct aspect ratio (React Native overrides native
 * layout params, so we correct visually via transform like the camera preview).
 */
class SeamlessPlayerView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  companion object {
    private const val TAG = "SeamlessPlayer"
    private const val CACHE_SIZE_BYTES = 200L * 1024 * 1024 // 200 MB
    @Volatile private var cache: SimpleCache? = null

    private fun getCache(context: Context): SimpleCache {
      return cache ?: synchronized(this) {
        cache ?: SimpleCache(
          java.io.File(context.cacheDir, "exo_chunk_cache"),
          LeastRecentlyUsedCacheEvictor(CACHE_SIZE_BYTES),
          com.google.android.exoplayer2.database.StandaloneDatabaseProvider(context)
        ).also { cache = it }
      }
    }
  }

  private val onPlaybackFinished by EventDispatcher()
  private val onPlaybackError by EventDispatcher()
  private val onLiveCaughtUp by EventDispatcher()

  private var player: ExoPlayer? = null
  private var concatenatingSource: ConcatenatingMediaSource? = null
  private var cacheDataSourceFactory: CacheDataSource.Factory? = null
  private val textureView = TextureView(context)
  private var pendingSeekMs: Long = 0L
  private var loadedChunkCount = 0
  private var isLiveMode = false
  /** Suppress STATE_ENDED briefly after a seek to avoid false "finished" events */
  private var suppressEnded = false

  init {
    addView(textureView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    textureView.layout(0, 0, r - l, b - t)
  }

  fun loadChunks(urls: List<String>) {
    releasePlayer()

    val loadControl = DefaultLoadControl.Builder()
      .setBufferDurationsMs(
        /* minBufferMs */ 30_000,
        /* maxBufferMs */ 120_000,
        /* bufferForPlaybackMs */ 1_500,
        /* bufferForPlaybackAfterRebufferMs */ 3_000
      )
      .build()

    val exoPlayer = ExoPlayer.Builder(context)
      .setLoadControl(loadControl)
      .build()
    exoPlayer.setVideoTextureView(textureView)

    // Set audio attributes for background playback support
    val audioAttrs = com.google.android.exoplayer2.audio.AudioAttributes.Builder()
      .setContentType(com.google.android.exoplayer2.C.AUDIO_CONTENT_TYPE_MOVIE)
      .setUsage(com.google.android.exoplayer2.C.USAGE_MEDIA)
      .build()
    exoPlayer.setAudioAttributes(audioAttrs, true)
    exoPlayer.setWakeMode(com.google.android.exoplayer2.C.WAKE_MODE_LOCAL)

    val httpFactory = DefaultHttpDataSource.Factory()
      .setConnectTimeoutMs(15_000)
      .setReadTimeoutMs(15_000)
      .setAllowCrossProtocolRedirects(true)
    val cachedFactory = CacheDataSource.Factory()
      .setCache(getCache(context))
      .setUpstreamDataSourceFactory(httpFactory)
    cacheDataSourceFactory = cachedFactory

    val concatenating = ConcatenatingMediaSource()
    for (url in urls) {
      val mediaSource = ProgressiveMediaSource.Factory(cachedFactory)
        .createMediaSource(MediaItem.fromUri(Uri.parse(url)))
      concatenating.addMediaSource(mediaSource)
    }
    concatenatingSource = concatenating
    loadedChunkCount = urls.size

    exoPlayer.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(state: Int) {
        Log.d(TAG, "State: $state, pendingSeek=$pendingSeekMs, suppress=$suppressEnded")
        if (state == Player.STATE_READY && pendingSeekMs > 0) {
          Log.d(TAG, "Applying pending seek: ${pendingSeekMs}ms")
          suppressEnded = true
          seekTo(pendingSeekMs)
          pendingSeekMs = 0L
        } else if (state == Player.STATE_READY && suppressEnded) {
          // Player buffered and is playing after the seek — safe to clear
          Log.d(TAG, "Seek complete, clearing suppressEnded")
          suppressEnded = false
        }
        if (state == Player.STATE_ENDED) {
          if (suppressEnded) {
            // Seek landed at or past the end — restart from beginning
            Log.d(TAG, "Seek landed at end, restarting from beginning")
            suppressEnded = false
            exoPlayer.seekTo(0, 0)
            exoPlayer.playWhenReady = true
          } else if (isLiveMode) {
            Log.d(TAG, "Reached end of available chunks (live mode — waiting for more)")
            if (exoPlayer.playbackParameters.speed != 1f) {
              exoPlayer.setPlaybackSpeed(1f)
              Log.d(TAG, "Live caught up — reset speed to 1x")
              onLiveCaughtUp(mapOf<String, Any>())
            }
          } else {
            Log.d(TAG, "Playback finished")
            onPlaybackFinished(mapOf<String, Any>())
          }
        }
      }

      override fun onVideoSizeChanged(size: VideoSize) {
        if (size.width > 0 && size.height > 0) {
          applyVideoTransform(size.width, size.height)
        }
      }

      override fun onPlayerError(error: com.google.android.exoplayer2.PlaybackException) {
        Log.e(TAG, "Playback error: ${error.message}", error)
        onPlaybackError(mapOf("message" to (error.message ?: "Playback error")))
      }
    })

    exoPlayer.setMediaSource(concatenating)
    exoPlayer.prepare()
    exoPlayer.playWhenReady = true
    player = exoPlayer

    // Register with PlaybackService for background audio + notification
    PlaybackService.currentPlayer = exoPlayer
    PlaybackService.onPlayerChanged()

    Log.d(TAG, "Playing ${urls.size} chunks via ConcatenatingMediaSource")
  }

  /**
   * Apply a transform to the TextureView so the video fills the width
   * and maintains its aspect ratio, like CSS "width:100%; height:auto".
   * The TextureView fills the parent (React Native forces this), so we
   * use a scale transform to correct the distortion.
   */
  private fun applyVideoTransform(videoW: Int, videoH: Int) {
    val viewWidth = textureView.width.toFloat()
    val viewHeight = textureView.height.toFloat()
    if (viewWidth == 0f || viewHeight == 0f) return

    val videoAspect = videoW.toFloat() / videoH.toFloat()
    val viewAspect = viewWidth / viewHeight

    val matrix = Matrix()

    // The TextureView is stretched to fill the parent (viewWidth x viewHeight).
    // The video has a different aspect ratio. We scale one axis down so the
    // video fills the width and the height adjusts proportionally.
    if (videoAspect < viewAspect) {
      // Video is taller (narrower) than view — scale X down to match
      val scaleX = videoAspect / viewAspect
      matrix.setScale(scaleX, 1f, viewWidth / 2f, viewHeight / 2f)
    } else {
      // Video is wider than view — scale Y down to match
      val scaleY = viewAspect / videoAspect
      matrix.setScale(1f, scaleY, viewWidth / 2f, viewHeight / 2f)
    }

    textureView.setTransform(matrix)
    Log.d(TAG, "Applied transform: video=${videoW}x${videoH}, view=${viewWidth}x${viewHeight}")
  }

  fun setStartPosition(positionMs: Long) {
    pendingSeekMs = positionMs
    Log.d(TAG, "startPosition set to ${positionMs}ms")
  }

  fun play() { player?.play() }
  fun pause() { player?.pause() }

  fun setSpeed(speed: Float) {
    val p = player ?: return
    p.setPlaybackSpeed(speed)
    Log.d(TAG, "setSpeed=$speed")
  }

  /**
   * Returns a packed position: windowIndex * 1_000_000 + windowPositionMs.
   * This avoids needing buffered durations to reconstruct an absolute position.
   */
  fun getPositionMs(): Long {
    val p = player ?: return 0L
    val packed = p.currentMediaItemIndex.toLong() * 1_000_000L + p.currentPosition
    Log.d(TAG, "getPositionMs: packed=$packed (window=${p.currentMediaItemIndex}, windowPos=${p.currentPosition})")
    return packed
  }

  /** Returns actual elapsed playback time in ms across all chunks */
  fun getElapsedMs(): Long {
    val p = player ?: return 0L
    val timeline = p.currentTimeline
    if (timeline.isEmpty) return p.currentPosition
    var totalMs = 0L
    val window = com.google.android.exoplayer2.Timeline.Window()
    for (i in 0 until p.currentMediaItemIndex) {
      timeline.getWindow(i, window)
      if (window.durationMs > 0) totalMs += window.durationMs
    }
    totalMs += p.currentPosition
    return totalMs
  }

  /** Seeks to a packed position (windowIndex * 1_000_000 + windowPositionMs).
   *  Seeks to the START of the chunk because Google Drive URLs don't support
   *  HTTP Range requests — seeking mid-chunk causes ExoPlayer to stall (416). */
  fun seekTo(positionMs: Long) {
    val p = player ?: return
    val windowIndex = (positionMs / 1_000_000L).toInt()
    Log.d(TAG, "seekTo: window=$windowIndex (start of chunk)")
    p.seekTo(windowIndex, 0)
  }

  /** Append new chunk URLs to the existing player without resetting playback */
  fun appendChunks(urls: List<String>) {
    val p = player ?: return
    val concat = concatenatingSource ?: return
    val factory = cacheDataSourceFactory ?: return
    val wasEnded = p.playbackState == Player.STATE_ENDED

    var added = 0
    for (url in urls) {
      val mediaSource = ProgressiveMediaSource.Factory(factory)
        .createMediaSource(MediaItem.fromUri(Uri.parse(url)))
      concat.addMediaSource(mediaSource)
      added++
    }
    val previousCount = loadedChunkCount
    loadedChunkCount += added
    Log.d(TAG, "Appended $added chunks (total=$loadedChunkCount, wasEnded=$wasEnded)")

    // If the player had reached the end, seek to the new content and resume
    if (wasEnded) {
      p.seekTo(previousCount, 0)
      p.playWhenReady = true
      Log.d(TAG, "Resuming playback from chunk $previousCount")
    }
  }

  fun setLiveMode(live: Boolean) {
    isLiveMode = live
    Log.d(TAG, "liveMode=$live")
  }

  fun getLoadedChunkCount(): Int = loadedChunkCount

  private fun releasePlayer() {
    PlaybackService.currentPlayer = null
    PlaybackService.onPlayerChanged()
    player?.release()
    player = null
    concatenatingSource = null
    cacheDataSourceFactory = null
    loadedChunkCount = 0
    isLiveMode = false
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    releasePlayer()
  }
}
