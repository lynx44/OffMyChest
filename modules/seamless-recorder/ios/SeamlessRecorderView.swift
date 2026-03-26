import ExpoModulesCore
import AVFoundation
import UIKit

/// Camera preview + seamless chunked recording using AVFoundation.
///
/// Uses AVCaptureSession with AVCaptureVideoDataOutput/AVCaptureAudioDataOutput
/// for continuous frame delivery. Writes chunks via AVAssetWriter, rotating to
/// a new file when the byte threshold is reached. The capture session never stops
/// during rotation, so the preview is uninterrupted.
class SeamlessRecorderView: ExpoView,
    AVCaptureVideoDataOutputSampleBufferDelegate,
    AVCaptureAudioDataOutputSampleBufferDelegate {

    private static let TAG = "SeamlessRecorder"

    // Default encoding parameters matching Android 480p
    private static let defaultVideoWidth = 640
    private static let defaultVideoHeight = 480
    private static let defaultVideoBitrate = 2_000_000
    private static let defaultAudioBitrate = 128_000
    private static let defaultFrameRate = 30
    private static let chunkMaxBytes = 1_400_000

    // MARK: - Event dispatchers

    let onChunkReady = EventDispatcher()
    let onError = EventDispatcher()

    // MARK: - Configuration

    private var facing: String = "front"
    private var videoWidth = defaultVideoWidth
    private var videoHeight = defaultVideoHeight

    // MARK: - AVFoundation state

    private var captureSession: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var videoDataOutput: AVCaptureVideoDataOutput?
    private var audioDataOutput: AVCaptureAudioDataOutput?
    private let sessionQueue = DispatchQueue(label: "seamless.recorder.session")
    private let writerQueue = DispatchQueue(label: "seamless.recorder.writer")

    // MARK: - AVAssetWriter state

    private var assetWriter: AVAssetWriter?
    private var videoWriterInput: AVAssetWriterInput?
    private var audioWriterInput: AVAssetWriterInput?
    private var isRecording = false
    private var isRotating = false
    private var writerStarted = false
    private var chunkIndex = 0
    private var bytesWritten = 0
    private var currentChunkURL: URL?

    // MARK: - Init

    required init(appContext: AppContext?) {
        super.init(appContext: appContext)
        setupCaptureSession()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        previewLayer?.frame = bounds
    }

    override func removeFromSuperview() {
        releaseAll()
        super.removeFromSuperview()
    }

    // MARK: - Props

    func setFacing(_ value: String) {
        guard value != facing else { return }
        facing = value
        if captureSession != nil && !isRecording {
            sessionQueue.async { [weak self] in
                self?.rebuildCaptureSession()
            }
        }
    }

    func setQuality(_ value: String) {
        switch value {
        case "480p":
            videoWidth = 640; videoHeight = 480
        case "720p":
            videoWidth = 1280; videoHeight = 720
        case "1080p":
            videoWidth = 1920; videoHeight = 1080
        default:
            break
        }
    }

    // MARK: - Capture Session Setup

    private func setupCaptureSession() {
        sessionQueue.async { [weak self] in
            self?.buildCaptureSession()
        }
    }

    private func rebuildCaptureSession() {
        captureSession?.stopRunning()
        DispatchQueue.main.sync { [weak self] in
            self?.previewLayer?.removeFromSuperlayer()
            self?.previewLayer = nil
        }
        captureSession = nil
        buildCaptureSession()
    }

    private func buildCaptureSession() {
        do {
            let session = AVCaptureSession()
            session.beginConfiguration()
            session.sessionPreset = .medium

            // Audio session
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true)

            // Camera input
            let position: AVCaptureDevice.Position = facing == "front" ? .front : .back
            guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) else {
                NSLog("[%@] No camera found for facing=%@", SeamlessRecorderView.TAG, facing)
                return
            }
            let videoInput = try AVCaptureDeviceInput(device: camera)
            if session.canAddInput(videoInput) {
                session.addInput(videoInput)
            }

            // Microphone input
            if let mic = AVCaptureDevice.default(for: .audio) {
                let audioInput = try AVCaptureDeviceInput(device: mic)
                if session.canAddInput(audioInput) {
                    session.addInput(audioInput)
                }
            }

            // Video data output
            let videoOutput = AVCaptureVideoDataOutput()
            videoOutput.setSampleBufferDelegate(self, queue: writerQueue)
            videoOutput.alwaysDiscardsLateVideoFrames = true
            if session.canAddOutput(videoOutput) {
                session.addOutput(videoOutput)
            }
            self.videoDataOutput = videoOutput

            // Configure video connection
            if let videoConnection = videoOutput.connection(with: .video) {
                if videoConnection.isVideoOrientationSupported {
                    videoConnection.videoOrientation = .portrait
                }
                if videoConnection.isVideoMirroringSupported && facing == "front" {
                    videoConnection.isVideoMirrored = true
                }
            }

            // Audio data output
            let audioOutput = AVCaptureAudioDataOutput()
            audioOutput.setSampleBufferDelegate(self, queue: writerQueue)
            if session.canAddOutput(audioOutput) {
                session.addOutput(audioOutput)
            }
            self.audioDataOutput = audioOutput

            session.commitConfiguration()
            captureSession = session

            // Preview layer (must be on main thread)
            DispatchQueue.main.sync { [weak self] in
                guard let self = self else { return }
                let layer = AVCaptureVideoPreviewLayer(session: session)
                layer.videoGravity = .resizeAspectFill
                layer.frame = self.bounds
                self.layer.addSublayer(layer)
                self.previewLayer = layer
            }

            session.startRunning()
            NSLog("[%@] Capture session started (facing=%@)", SeamlessRecorderView.TAG, facing)
        } catch {
            NSLog("[%@] Failed to setup capture session: %@", SeamlessRecorderView.TAG, error.localizedDescription)
        }
    }

    // MARK: - Recording

    func startRecording(promise: Promise) {
        if isRecording {
            promise.reject("ERR_ALREADY_RECORDING", "Already recording")
            return
        }

        writerQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                self.chunkIndex = 0
                self.bytesWritten = 0
                self.writerStarted = false

                let url = self.createChunkFile(index: 0)
                self.currentChunkURL = url
                try self.createAssetWriter(for: url)

                self.isRecording = true
                NSLog("[%@] Recording started — chunk 0", SeamlessRecorderView.TAG)
                DispatchQueue.main.async { promise.resolve(nil) }
            } catch {
                NSLog("[%@] startRecording failed: %@", SeamlessRecorderView.TAG, error.localizedDescription)
                DispatchQueue.main.async {
                    promise.reject("ERR_START", error.localizedDescription)
                }
            }
        }
    }

    func stopRecording(promise: Promise) {
        guard isRecording else {
            promise.resolve(nil)
            return
        }
        isRecording = false

        writerQueue.async { [weak self] in
            guard let self = self else {
                DispatchQueue.main.async { promise.resolve(nil) }
                return
            }
            self.finishCurrentWriter { [weak self] in
                guard let self = self else { return }
                self.emitCurrentChunk()
                NSLog("[%@] Recording stopped after %d chunks", SeamlessRecorderView.TAG, self.chunkIndex + 1)
                DispatchQueue.main.async { promise.resolve(nil) }
            }
        }
    }

    // MARK: - AVCaptureOutput Delegate

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard isRecording, !isRotating else { return }
        guard let writer = assetWriter else { return }

        // Start writer session on first buffer
        if !writerStarted {
            let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            guard writer.startWriting() else {
                NSLog("[%@] Failed to start writing: %@", SeamlessRecorderView.TAG,
                      writer.error?.localizedDescription ?? "unknown")
                return
            }
            writer.startSession(atSourceTime: timestamp)
            writerStarted = true
        }

        guard writer.status == .writing else { return }

        // Route to correct input
        if output === videoDataOutput, let input = videoWriterInput, input.isReadyForMoreMediaData {
            input.append(sampleBuffer)
            bytesWritten += CMSampleBufferGetTotalSampleSize(sampleBuffer)
        } else if output === audioDataOutput, let input = audioWriterInput, input.isReadyForMoreMediaData {
            input.append(sampleBuffer)
            bytesWritten += CMSampleBufferGetTotalSampleSize(sampleBuffer)
        }

        // Check if chunk rotation needed
        if bytesWritten >= SeamlessRecorderView.chunkMaxBytes {
            rotateChunk()
        }
    }

    // MARK: - Chunk Rotation

    private func rotateChunk() {
        isRotating = true

        finishCurrentWriter { [weak self] in
            guard let self = self else { return }
            // Emit the completed chunk
            self.emitCurrentChunk()
            self.chunkIndex += 1

            // Create new writer for next chunk
            do {
                let url = self.createChunkFile(index: self.chunkIndex)
                self.currentChunkURL = url
                self.bytesWritten = 0
                self.writerStarted = false
                try self.createAssetWriter(for: url)
                self.isRotating = false
                NSLog("[%@] Switched to chunk %d", SeamlessRecorderView.TAG, self.chunkIndex)
            } catch {
                NSLog("[%@] Failed to create new chunk writer: %@",
                      SeamlessRecorderView.TAG, error.localizedDescription)
                self.isRotating = false
                self.isRecording = false
                DispatchQueue.main.async {
                    self.onError(["message": "Failed to prepare next chunk: \(error.localizedDescription)"])
                }
            }
        }
    }

    private func finishCurrentWriter(completion: @escaping () -> Void) {
        guard let writer = assetWriter, writer.status == .writing else {
            completion()
            return
        }
        videoWriterInput?.markAsFinished()
        audioWriterInput?.markAsFinished()
        writer.finishWriting {
            completion()
        }
    }

    private func emitCurrentChunk() {
        guard let url = currentChunkURL else { return }
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: url.path) else { return }
        let attrs = try? fileManager.attributesOfItem(atPath: url.path)
        let size = attrs?[.size] as? UInt64 ?? 0
        guard size > 0 else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.onChunkReady([
                "index": self.chunkIndex,
                "uri": self.currentChunkURL?.absoluteString ?? ""
            ])
        }
    }

    // MARK: - AVAssetWriter Setup

    private func createAssetWriter(for url: URL) throws {
        // Remove existing file if present
        let fm = FileManager.default
        if fm.fileExists(atPath: url.path) {
            try fm.removeItem(at: url)
        }

        let writer = try AVAssetWriter(url: url, fileType: .mp4)

        // Video input
        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: videoWidth,
            AVVideoHeightKey: videoHeight,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: SeamlessRecorderView.defaultVideoBitrate,
                AVVideoExpectedSourceFrameRateKey: SeamlessRecorderView.defaultFrameRate,
                AVVideoMaxKeyFrameIntervalKey: SeamlessRecorderView.defaultFrameRate
            ]
        ]
        let vInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        vInput.expectsMediaDataInRealTime = true
        if writer.canAdd(vInput) { writer.add(vInput) }
        videoWriterInput = vInput

        // Audio input
        let audioSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: SeamlessRecorderView.defaultAudioBitrate
        ]
        let aInput = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
        aInput.expectsMediaDataInRealTime = true
        if writer.canAdd(aInput) { writer.add(aInput) }
        audioWriterInput = aInput

        assetWriter = writer
    }

    // MARK: - File Helpers

    private func createChunkFile(index: Int) -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("seamless_recorder")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(String(format: "chunk_%03d.mp4", index))
    }

    // MARK: - Lifecycle

    private func releaseAll() {
        isRecording = false
        isRotating = false

        if let writer = assetWriter, writer.status == .writing {
            videoWriterInput?.markAsFinished()
            audioWriterInput?.markAsFinished()
            writer.cancelWriting()
        }
        assetWriter = nil
        videoWriterInput = nil
        audioWriterInput = nil

        captureSession?.stopRunning()
        captureSession = nil

        DispatchQueue.main.async { [weak self] in
            self?.previewLayer?.removeFromSuperlayer()
            self?.previewLayer = nil
        }
    }
}
