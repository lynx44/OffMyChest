package expo.modules.seamlessrecorder

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues

class SeamlessRecorderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoSeamlessRecorder")

    View(SeamlessRecorderView::class) {
      Events("onChunkReady", "onError")

      Prop("facing") { view: SeamlessRecorderView, facing: String ->
        view.setFacing(facing)
      }

      Prop("videoQuality") { view: SeamlessRecorderView, quality: String ->
        view.setQuality(quality)
      }

      Prop("sessionId") { view: SeamlessRecorderView, sessionId: String ->
        view.setSessionId(sessionId)
      }

      AsyncFunction("startRecording") { view: SeamlessRecorderView, promise: Promise ->
        view.startRecording(promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("stopRecording") { view: SeamlessRecorderView, promise: Promise ->
        view.stopRecording(promise)
      }.runOnQueue(Queues.MAIN)
    }
  }
}
