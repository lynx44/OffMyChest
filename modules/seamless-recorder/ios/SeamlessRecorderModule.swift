import ExpoModulesCore

public class SeamlessRecorderModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoSeamlessRecorder")

        View(SeamlessRecorderView.self) {
            Events("onChunkReady", "onError")

            Prop("facing") { (view: SeamlessRecorderView, facing: String?) in
                view.setFacing(facing ?? "front")
            }

            Prop("videoQuality") { (view: SeamlessRecorderView, quality: String?) in
                view.setQuality(quality ?? "480p")
            }

            AsyncFunction("startRecording") { (view: SeamlessRecorderView, promise: Promise) in
                view.startRecording(promise: promise)
            }.runOnQueue(.main)

            AsyncFunction("stopRecording") { (view: SeamlessRecorderView, promise: Promise) in
                view.stopRecording(promise: promise)
            }.runOnQueue(.main)
        }
    }
}
