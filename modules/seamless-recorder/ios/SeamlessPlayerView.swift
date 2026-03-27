import ExpoModulesCore
import AVFoundation
import MediaPlayer
import UIKit

// MARK: - Chunk Cache

/// Downloads remote chunks to local temp files so AVQueuePlayer reads from disk
/// instead of streaming, eliminating network latency at chunk boundaries.
private class ChunkCache {
    static let shared = ChunkCache()
    private let cacheDir: URL
    private let session: URLSession
    private var pending: [URL: URLSessionDownloadTask] = [:]
    private var cached: [URL: URL] = [:]  // remote URL → local file URL
    private let queue = DispatchQueue(label: "ChunkCache")

    init() {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("chunk_cache")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        cacheDir = dir
        let config = URLSessionConfiguration.default
        config.httpMaximumConnectionsPerHost = 4
        session = URLSession(configuration: config)
    }

    /// Returns local file URL if cached, otherwise nil
    func localURL(for remote: URL) -> URL? {
        queue.sync { cached[remote] }
    }

    /// Start downloading a chunk in the background
    func prefetch(_ remote: URL) {
        queue.sync {
            if cached[remote] != nil || pending[remote] != nil { return }
            let task = session.downloadTask(with: remote) { [weak self] tmpURL, _, error in
                guard let self = self, let tmpURL = tmpURL, error == nil else { return }
                let dest = self.cacheDir.appendingPathComponent(UUID().uuidString + ".mp4")
                try? FileManager.default.moveItem(at: tmpURL, to: dest)
                self.queue.sync {
                    self.cached[remote] = dest
                    self.pending.removeValue(forKey: remote)
                }
            }
            pending[remote] = task
            task.resume()
        }
    }

    /// Prefetch multiple URLs
    func prefetchAll(_ urls: [URL]) {
        for url in urls { prefetch(url) }
    }

    func cancelAll() {
        queue.sync {
            for (_, task) in pending { task.cancel() }
            pending.removeAll()
        }
    }

    func clear() {
        cancelAll()
        queue.sync {
            for (_, local) in cached {
                try? FileManager.default.removeItem(at: local)
            }
            cached.removeAll()
        }
    }
}

class SeamlessPlayerView: ExpoView {

    private static let TAG = "SeamlessPlayer"

    let onPlaybackFinished = EventDispatcher()
    let onPlaybackError = EventDispatcher()
    let onLiveCaughtUp = EventDispatcher()

    private var player: AVQueuePlayer?
    private var playerLayer: AVPlayerLayer?
    /// Ordered list of all items ever loaded (AVQueuePlayer removes played items internally)
    private var allItems: [AVPlayerItem] = []
    /// URLs corresponding to allItems by index
    private var allURLs: [URL] = []
    private var loadedChunkCount = 0
    private var isLiveMode = false
    private var pendingSeekMs: Int64 = 0
    private var suppressEnded = false
    private var statusObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var errorObservers: [NSObjectProtocol] = []
    private let chunkCache = ChunkCache.shared

    required init(appContext: AppContext?) {
        super.init(appContext: appContext)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        playerLayer?.frame = bounds
    }

    override func removeFromSuperview() {
        releasePlayer()
        super.removeFromSuperview()
    }

    /// Create an AVPlayerItem from a cached local file if available, else stream from remote
    private func makeItem(url: URL) -> AVPlayerItem {
        let playURL = chunkCache.localURL(for: url) ?? url
        let item = AVPlayerItem(url: playURL)
        item.preferredForwardBufferDuration = 30
        return item
    }

    // MARK: - Public API

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .moviePlayback)
            try session.setActive(true)
        } catch {
            NSLog("[%@] Audio session setup failed: %@", SeamlessPlayerView.TAG, error.localizedDescription)
        }
    }

    private func setupRemoteCommandCenter() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.removeTarget(nil)
        center.playCommand.addTarget { [weak self] _ in
            self?.player?.play()
            return .success
        }

        center.pauseCommand.removeTarget(nil)
        center.pauseCommand.addTarget { [weak self] _ in
            self?.player?.pause()
            return .success
        }

        center.togglePlayPauseCommand.removeTarget(nil)
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let player = self?.player else { return .commandFailed }
            if player.rate > 0 {
                player.pause()
            } else {
                player.play()
            }
            return .success
        }

        // Disable unsupported commands
        center.nextTrackCommand.isEnabled = false
        center.previousTrackCommand.isEnabled = false
    }

    private func updateNowPlayingInfo() {
        var info = [String: Any]()
        info[MPMediaItemPropertyTitle] = "Off My Chest"
        info[MPMediaItemPropertyArtist] = "Video Message"
        if let player = player, let currentItem = player.currentItem {
            let elapsed = CMTimeGetSeconds(player.currentTime())
            let duration = CMTimeGetSeconds(currentItem.duration)
            if elapsed.isFinite { info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed }
            if duration.isFinite && duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
            info[MPNowPlayingInfoPropertyPlaybackRate] = player.rate
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func clearNowPlayingInfo() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.removeTarget(nil)
        center.pauseCommand.removeTarget(nil)
        center.togglePlayPauseCommand.removeTarget(nil)
    }

    func loadChunks(_ urls: [String]) {
        releasePlayer()

        // Configure audio session for background playback
        configureAudioSession()

        // Start prefetching all chunks to local disk
        let remoteURLs = urls.compactMap { URL(string: $0) }
        chunkCache.prefetchAll(remoteURLs)

        let queuePlayer = AVQueuePlayer()
        queuePlayer.actionAtItemEnd = .advance

        var items: [AVPlayerItem] = []
        var itemURLs: [URL] = []
        for urlString in urls {
            guard let url = URL(string: urlString) else { continue }
            let item = makeItem(url: url)
            items.append(item)
            itemURLs.append(url)
            queuePlayer.insert(item, after: nil)
        }

        allItems = items
        allURLs = itemURLs
        loadedChunkCount = items.count

        let layer = AVPlayerLayer(player: queuePlayer)
        layer.videoGravity = .resizeAspectFill
        layer.frame = bounds
        self.layer.addSublayer(layer)
        playerLayer = layer
        player = queuePlayer

        // Observe end-of-item notifications
        for item in items {
            observeItemEnd(item)
        }

        // Observe first item status for pending seek
        if let firstItem = items.first {
            observeItemStatus(firstItem)
        }

        // Observe errors
        observePlayerErrors(queuePlayer)

        // Set up lock screen / control center controls
        setupRemoteCommandCenter()
        updateNowPlayingInfo()

        queuePlayer.play()
        NSLog("[%@] Playing %d chunks", SeamlessPlayerView.TAG, urls.count)
    }

    func setStartPosition(_ positionMs: Int64) {
        pendingSeekMs = positionMs
        NSLog("[%@] startPosition set to %lldms", SeamlessPlayerView.TAG, positionMs)
    }

    func play() {
        player?.play()
        updateNowPlayingInfo()
    }

    func pause() {
        player?.pause()
        updateNowPlayingInfo()
    }

    func setSpeed(_ speed: Float) {
        player?.rate = speed
        NSLog("[%@] setSpeed=%f", SeamlessPlayerView.TAG, speed)
    }

    func getPositionMs() -> Int64 {
        guard let player = player, let currentItem = player.currentItem else { return 0 }
        let currentIndex = allItems.firstIndex(where: { $0 === currentItem }) ?? 0
        let currentTimeMs = Int64(CMTimeGetSeconds(player.currentTime()) * 1000)
        let packed = Int64(currentIndex) * 1_000_000 + max(0, currentTimeMs)
        return packed
    }

    func getElapsedMs() -> Int64 {
        guard let player = player, let currentItem = player.currentItem else { return 0 }
        let currentIndex = allItems.firstIndex(where: { $0 === currentItem }) ?? 0
        var totalMs: Int64 = 0
        for i in 0..<currentIndex {
            let duration = CMTimeGetSeconds(allItems[i].duration)
            if duration.isFinite && duration > 0 {
                totalMs += Int64(duration * 1000)
            }
        }
        let currentTimeMs = Int64(CMTimeGetSeconds(player.currentTime()) * 1000)
        totalMs += max(0, currentTimeMs)
        return totalMs
    }

    /// Seeks to a packed position (windowIndex * 1_000_000 + windowPositionMs).
    /// Seeks to the START of the chunk because Google Drive URLs don't support
    /// HTTP Range requests.
    func seekTo(_ positionMs: Int64) {
        guard let player = player else { return }
        let windowIndex = Int(positionMs / 1_000_000)
        guard windowIndex < allURLs.count else { return }

        NSLog("[%@] seekTo: window=%d (start of chunk)", SeamlessPlayerView.TAG, windowIndex)
        suppressEnded = true

        // AVQueuePlayer removes played items, so we must rebuild the queue
        // from the target index. AVPlayerItems can't be reused after removal.
        player.removeAllItems()
        removeEndObservers()

        var newItems: [AVPlayerItem] = []
        for i in 0..<allURLs.count {
            if i < windowIndex {
                let item = makeItem(url: allURLs[i])
                allItems[i] = item
                newItems.append(item)
            } else {
                let item = makeItem(url: allURLs[i])
                allItems[i] = item
                newItems.append(item)
                player.insert(item, after: player.items().last)
                observeItemEnd(item)
            }
        }

        player.seek(to: .zero)
        player.play()

        // Observe first playable item status to clear suppressEnded
        if windowIndex < allItems.count {
            observeItemStatus(allItems[windowIndex])
        }
    }

    func appendChunks(_ urls: [String]) {
        guard let player = player else { return }
        let wasEmpty = player.items().isEmpty
        let previousCount = loadedChunkCount

        // Prefetch new chunks
        chunkCache.prefetchAll(urls.compactMap { URL(string: $0) })

        for urlString in urls {
            guard let url = URL(string: urlString) else { continue }
            let item = makeItem(url: url)
            observeItemEnd(item)
            player.insert(item, after: player.items().last)
            allItems.append(item)
            allURLs.append(url)
        }
        loadedChunkCount += urls.count
        NSLog("[%@] Appended %d chunks (total=%d, wasEmpty=%@)",
              SeamlessPlayerView.TAG, urls.count, loadedChunkCount, wasEmpty ? "true" : "false")

        if wasEmpty {
            player.play()
            NSLog("[%@] Resuming playback from chunk %d", SeamlessPlayerView.TAG, previousCount)
        }
    }

    func setLiveMode(_ live: Bool) {
        isLiveMode = live
        NSLog("[%@] liveMode=%@", SeamlessPlayerView.TAG, live ? "true" : "false")
    }

    func getLoadedChunkCount() -> Int {
        return loadedChunkCount
    }

    // MARK: - Observers

    private func observeItemEnd(_ item: AVPlayerItem) {
        let observer = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] notification in
            self?.handleItemDidPlayToEnd(notification)
        }
        errorObservers.append(observer)
    }

    private func observeItemStatus(_ item: AVPlayerItem) {
        statusObservation?.invalidate()
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard let self = self else { return }
            DispatchQueue.main.async {
                if item.status == .readyToPlay {
                    if self.pendingSeekMs > 0 {
                        NSLog("[%@] Applying pending seek: %lldms", SeamlessPlayerView.TAG, self.pendingSeekMs)
                        self.suppressEnded = true
                        let seekMs = self.pendingSeekMs
                        self.pendingSeekMs = 0
                        self.seekTo(seekMs)
                    } else if self.suppressEnded {
                        NSLog("[%@] Seek complete, clearing suppressEnded", SeamlessPlayerView.TAG)
                        self.suppressEnded = false
                    }
                    self.statusObservation?.invalidate()
                    self.statusObservation = nil
                } else if item.status == .failed {
                    let msg = item.error?.localizedDescription ?? "Playback error"
                    NSLog("[%@] Item failed: %@", SeamlessPlayerView.TAG, msg)
                    self.onPlaybackError(["message": msg])
                }
            }
        }
    }

    private func observePlayerErrors(_ player: AVQueuePlayer) {
        let observer = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
            let msg = error?.localizedDescription ?? "Playback error"
            NSLog("[%@] Playback error: %@", SeamlessPlayerView.TAG, msg)
            self?.onPlaybackError(["message": msg])
        }
        errorObservers.append(observer)
    }

    private func handleItemDidPlayToEnd(_ notification: Notification) {
        guard let finishedItem = notification.object as? AVPlayerItem else { return }

        if suppressEnded {
            // Seek landed at or past the end — restart from beginning
            NSLog("[%@] Seek landed at end, restarting from beginning", SeamlessPlayerView.TAG)
            suppressEnded = false
            player?.seek(to: .zero)
            player?.play()
            return
        }

        if isLiveMode {
            NSLog("[%@] Reached end of available chunks (live mode — waiting for more)", SeamlessPlayerView.TAG)
            if let player = player, player.rate > 1.0 {
                NSLog("[%@] Live caught up — reset speed to 1x", SeamlessPlayerView.TAG)
                onLiveCaughtUp([:])
            }
            return
        }

        // Check if this was the last item
        let isLast = finishedItem === allItems.last || player?.items().isEmpty == true
        if isLast {
            NSLog("[%@] Playback finished", SeamlessPlayerView.TAG)
            onPlaybackFinished([:])
        }
    }

    private func removeEndObservers() {
        for observer in errorObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        errorObservers.removeAll()
    }

    // MARK: - Cleanup

    private func releasePlayer() {
        statusObservation?.invalidate()
        statusObservation = nil
        removeEndObservers()
        clearNowPlayingInfo()
        chunkCache.cancelAll()
        player?.pause()
        player?.removeAllItems()
        playerLayer?.removeFromSuperlayer()
        playerLayer = nil
        player = nil
        allItems.removeAll()
        allURLs.removeAll()
        loadedChunkCount = 0
        isLiveMode = false
        suppressEnded = false
        pendingSeekMs = 0
    }
}
