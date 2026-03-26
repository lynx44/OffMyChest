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
  private val textureView = TextureView(context)

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

    val dataSourceFactory = DefaultHttpDataSource.Factory()
      .setConnectTimeoutMs(15_000)
      .setReadTimeoutMs(15_000)
      .setAllowCrossProtocolRedirects(true)

    val concatenating = ConcatenatingMediaSource()
    for (url in urls) {
      val mediaSource = ProgressiveMediaSource.Factory(dataSourceFactory)
        .createMediaSource(MediaItem.fromUri(Uri.parse(url)))
      concatenating.addMediaSource(mediaSource)
    }

    exoPlayer.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_ENDED) {
          Log.d(TAG, "Playback finished")
          onPlaybackFinished(mapOf<String, Any>())
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

  fun play() { player?.play() }
  fun pause() { player?.pause() }

  private fun releasePlayer() {
    player?.release()
    player = null
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    releasePlayer()
  }
}
