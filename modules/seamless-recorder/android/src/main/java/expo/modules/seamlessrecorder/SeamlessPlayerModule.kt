package expo.modules.seamlessrecorder

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

class SeamlessPlayerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoSeamlessPlayer")

    View(SeamlessPlayerView::class) {
      Events("onPlaybackFinished", "onPlaybackError")

      Prop("chunks") { view: SeamlessPlayerView, chunks: List<String> ->
        view.loadChunks(chunks)
      }

      AsyncFunction("play") { view: SeamlessPlayerView ->
        view.play()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("pause") { view: SeamlessPlayerView ->
        view.pause()
      }.runOnQueue(Queues.MAIN)
    }
  }
}
