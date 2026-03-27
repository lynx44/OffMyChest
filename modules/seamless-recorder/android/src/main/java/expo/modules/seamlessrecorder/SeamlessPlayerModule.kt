package expo.modules.seamlessrecorder

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

class SeamlessPlayerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoSeamlessPlayer")

    AsyncFunction("startBackgroundPlayback") {
      val context = appContext.reactContext ?: return@AsyncFunction null
      PlaybackService.start(context)
      null
    }

    AsyncFunction("stopBackgroundPlayback") {
      val context = appContext.reactContext ?: return@AsyncFunction null
      PlaybackService.stop(context)
      null
    }

    View(SeamlessPlayerView::class) {
      Events("onPlaybackFinished", "onPlaybackError", "onLiveCaughtUp")

      Prop("chunks") { view: SeamlessPlayerView, chunks: List<String> ->
        view.loadChunks(chunks)
      }

      Prop("startPosition") { view: SeamlessPlayerView, positionMs: Long ->
        view.setStartPosition(positionMs)
      }

      Prop("liveMode") { view: SeamlessPlayerView, live: Boolean ->
        view.setLiveMode(live)
      }

      AsyncFunction("play") { view: SeamlessPlayerView ->
        view.play()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("pause") { view: SeamlessPlayerView ->
        view.pause()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("getPositionMs") { view: SeamlessPlayerView ->
        view.getPositionMs()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("getElapsedMs") { view: SeamlessPlayerView ->
        view.getElapsedMs()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("seekTo") { view: SeamlessPlayerView, positionMs: Long ->
        view.seekTo(positionMs)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("setSpeed") { view: SeamlessPlayerView, speed: Float ->
        view.setSpeed(speed)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("appendChunks") { view: SeamlessPlayerView, urls: List<String> ->
        view.appendChunks(urls)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("getLoadedChunkCount") { view: SeamlessPlayerView ->
        view.getLoadedChunkCount()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("seekToChunk") { view: SeamlessPlayerView, windowIndex: Int ->
        view.seekToChunk(windowIndex)
      }.runOnQueue(Queues.MAIN)
    }
  }
}
