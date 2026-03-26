package expo.modules.seamlessrecorder

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.net.Uri
import android.util.Log
import android.view.TextureView
import com.google.android.exoplayer2.ExoPlayer
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.Player
import com.google.android.exoplayer2.source.ConcatenatingMediaSource
import com.google.android.exoplayer2.source.ProgressiveMediaSource
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource
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
  }

  private val onPlaybackFinished by EventDispatcher()
  private val onPlaybackError by EventDispatcher()

  private var player: ExoPlayer? = null
  private var concatenatingSource: ConcatenatingMediaSource? = null
  private var dataSourceFactory: DefaultHttpDataSource.Factory? = null
  private val textureView = TextureView(context)
  private var pendingSeekMs: Long = 0L
  private var loadedChunkCount = 0
  private var isLiveMode = false

  init {
    addView(textureView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    textureView.layout(0, 0, r - l, b - t)
  }

  fun loadChunks(urls: List<String>) {
    releasePlayer()

    val exoPlayer = ExoPlayer.Builder(context).build()
    exoPlayer.setVideoTextureView(textureView)

    val dsFactory = DefaultHttpDataSource.Factory()
      .setConnectTimeoutMs(15_000)
      .setReadTimeoutMs(15_000)
      .setAllowCrossProtocolRedirects(true)
    dataSourceFactory = dsFactory

    val concatenating = ConcatenatingMediaSource()
    for (url in urls) {
      val mediaSource = ProgressiveMediaSource.Factory(dsFactory)
        .createMediaSource(MediaItem.fromUri(Uri.parse(url)))
      concatenating.addMediaSource(mediaSource)
    }
    concatenatingSource = concatenating
    loadedChunkCount = urls.size

    exoPlayer.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_READY && pendingSeekMs > 0) {
          Log.d(TAG, "Applying pending seek: ${pendingSeekMs}ms")
          seekTo(pendingSeekMs)
          pendingSeekMs = 0L
        }
        if (state == Player.STATE_ENDED) {
          if (isLiveMode) {
            Log.d(TAG, "Reached end of available chunks (live mode — waiting for more)")
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

  /** Returns the absolute position across all chunks in ms */
  fun getPositionMs(): Long {
    val p = player ?: return 0L
    val timeline = p.currentTimeline
    if (timeline.isEmpty) return p.currentPosition

    var totalMs = 0L
    val window = com.google.android.exoplayer2.Timeline.Window()
    for (i in 0 until p.currentMediaItemIndex) {
      timeline.getWindow(i, window)
      totalMs += window.durationMs
    }
    totalMs += p.currentPosition
    Log.d(TAG, "getPositionMs: $totalMs (window=${p.currentMediaItemIndex}, windowPos=${p.currentPosition})")
    return totalMs
  }

  /** Seeks to an absolute position across all chunks */
  fun seekTo(positionMs: Long) {
    val p = player ?: return
    val timeline = p.currentTimeline
    if (timeline.isEmpty) {
      p.seekTo(positionMs)
      return
    }

    var remaining = positionMs
    val window = com.google.android.exoplayer2.Timeline.Window()
    for (i in 0 until timeline.windowCount) {
      timeline.getWindow(i, window)
      if (remaining < window.durationMs) {
        Log.d(TAG, "seekTo: ${positionMs}ms → window=$i, offset=${remaining}ms")
        p.seekTo(i, remaining)
        return
      }
      remaining -= window.durationMs
    }
    // Past the end — seek to last window
    val lastIdx = timeline.windowCount - 1
    timeline.getWindow(lastIdx, window)
    Log.d(TAG, "seekTo: ${positionMs}ms → last window=$lastIdx")
    p.seekTo(lastIdx, window.durationMs)
  }

  /** Append new chunk URLs to the existing player without resetting playback */
  fun appendChunks(urls: List<String>) {
    val p = player ?: return
    val concat = concatenatingSource ?: return
    val factory = dataSourceFactory ?: return
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
    player?.release()
    player = null
    concatenatingSource = null
    dataSourceFactory = null
    loadedChunkCount = 0
    isLiveMode = false
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    releasePlayer()
  }
}
