package expo.modules.seamlessrecorder

import android.content.Context
import android.net.Uri
import android.util.Log
import android.view.SurfaceView
import com.google.android.exoplayer2.ExoPlayer
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.Player
import com.google.android.exoplayer2.source.ConcatenatingMediaSource
import com.google.android.exoplayer2.source.ProgressiveMediaSource
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Native ExoPlayer view that plays a list of MP4 chunk URLs seamlessly
 * using ConcatenatingMediaSource. No HLS conversion needed.
 */
class SeamlessPlayerView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  companion object {
    private const val TAG = "SeamlessPlayer"
  }

  private val onPlaybackFinished by EventDispatcher()
  private val onPlaybackError by EventDispatcher()

  private var player: ExoPlayer? = null
  private val surfaceView = SurfaceView(context)

  init {
    addView(surfaceView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    surfaceView.layout(0, 0, r - l, b - t)
  }

  fun loadChunks(urls: List<String>) {
    releasePlayer()

    val exoPlayer = ExoPlayer.Builder(context).build()
    exoPlayer.setVideoSurfaceView(surfaceView)

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
