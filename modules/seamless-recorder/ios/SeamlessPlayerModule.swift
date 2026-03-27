import ExpoModulesCore

public class SeamlessPlayerModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoSeamlessPlayer")

        // Background playback - on iOS, audio session is configured in the view.
        // These are no-ops to match the Android API surface.
        AsyncFunction("startBackgroundPlayback") { }
        AsyncFunction("stopBackgroundPlayback") { }

        View(SeamlessPlayerView.self) {
            Events("onPlaybackFinished", "onPlaybackError", "onLiveCaughtUp")

            Prop("chunks") { (view: SeamlessPlayerView, chunks: [String]?) in
                if let chunks = chunks {
                    view.loadChunks(chunks)
                }
            }

            Prop("startPosition") { (view: SeamlessPlayerView, positionMs: Int?) in
                view.setStartPosition(Int64(positionMs ?? 0))
            }

            Prop("liveMode") { (view: SeamlessPlayerView, live: Bool?) in
                view.setLiveMode(live ?? false)
            }

            AsyncFunction("play") { (view: SeamlessPlayerView) in
                view.play()
            }.runOnQueue(.main)

            AsyncFunction("pause") { (view: SeamlessPlayerView) in
                view.pause()
            }.runOnQueue(.main)

            AsyncFunction("getPositionMs") { (view: SeamlessPlayerView) -> Int in
                return Int(view.getPositionMs())
            }.runOnQueue(.main)

            AsyncFunction("getElapsedMs") { (view: SeamlessPlayerView) -> Int in
                return Int(view.getElapsedMs())
            }.runOnQueue(.main)

            AsyncFunction("seekTo") { (view: SeamlessPlayerView, positionMs: Int) in
                view.seekTo(Int64(positionMs))
            }.runOnQueue(.main)

            AsyncFunction("setSpeed") { (view: SeamlessPlayerView, speed: Float) in
                view.setSpeed(speed)
            }.runOnQueue(.main)

            AsyncFunction("appendChunks") { (view: SeamlessPlayerView, urls: [String]) in
                view.appendChunks(urls)
            }.runOnQueue(.main)

            AsyncFunction("getLoadedChunkCount") { (view: SeamlessPlayerView) -> Int in
                return view.getLoadedChunkCount()
            }.runOnQueue(.main)

            AsyncFunction("seekToChunk") { (view: SeamlessPlayerView, windowIndex: Int) in
                view.seekToChunk(windowIndex)
            }.runOnQueue(.main)
        }
    }
}
