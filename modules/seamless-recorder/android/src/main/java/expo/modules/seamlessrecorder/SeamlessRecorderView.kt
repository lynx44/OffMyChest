package expo.modules.seamlessrecorder

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.hardware.camera2.*
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import android.view.TextureView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File

/**
 * Camera preview + seamless chunked recording using Camera2 and
 * MediaRecorder.setNextOutputFile().
 *
 * setNextOutputFile (API 26+) switches output files mid-recording with zero
 * frame loss. Chunk rotation is driven by setMaxFileSize: when the current
 * file approaches maxFileSize the INFO listener fires, we supply the next
 * file, and MediaRecorder seamlessly transitions.
 */
class SeamlessRecorderView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  companion object {
    private const val TAG = "SeamlessRecorder"

    // Defaults for 480p recording — yields ~4-second chunks
    private const val DEFAULT_VIDEO_WIDTH = 640
    private const val DEFAULT_VIDEO_HEIGHT = 480
    private const val DEFAULT_VIDEO_BITRATE = 2_000_000
    private const val DEFAULT_AUDIO_BITRATE = 128_000
    private const val DEFAULT_FRAME_RATE = 30
    // Target chunk size: 4 seconds × (video + audio bitrate) / 8 bits, plus margin
    private const val DEFAULT_CHUNK_MAX_BYTES: Long = 1_400_000
  }

  // --- JS event dispatchers (wired by Events(...) in the module definition) ---
  private val onChunkReady by EventDispatcher()
  private val onError by EventDispatcher()

  // --- Props ---
  private var facing: String = "front"
  private var videoWidth = DEFAULT_VIDEO_WIDTH
  private var videoHeight = DEFAULT_VIDEO_HEIGHT

  // --- Camera2 state ---
  private var cameraDevice: CameraDevice? = null
  private var captureSession: CameraCaptureSession? = null
  private var backgroundThread: HandlerThread? = null
  private var backgroundHandler: Handler? = null

  // --- MediaRecorder state ---
  private var mediaRecorder: MediaRecorder? = null
  private var isRecording = false
  private var chunkIndex = 0
  private var currentChunkFile: File? = null

  // --- TextureView for preview ---
  private val textureView = TextureView(context).also { tv ->
    tv.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) {
        openCameraForPreview()
      }
      override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {}
      override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        releaseAll()
        return true
      }
      override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
    }
  }

  init {
    addView(textureView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    textureView.layout(0, 0, r - l, b - t)
  }

  // ---------- Props ----------

  fun setFacing(value: String) {
    if (value != facing) {
      facing = value
      // If preview is active, restart with new camera
      if (cameraDevice != null && !isRecording) {
        releaseCamera()
        openCameraForPreview()
      }
    }
  }

  fun setQuality(value: String) {
    when (value) {
      "480p" -> { videoWidth = 640; videoHeight = 480 }
      "720p" -> { videoWidth = 1280; videoHeight = 720 }
      "1080p" -> { videoWidth = 1920; videoHeight = 1080 }
    }
  }

  // ---------- Preview (camera open without recording) ----------

  @SuppressLint("MissingPermission")
  private fun openCameraForPreview() {
    startBackgroundThread()
    val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    val cameraId = findCameraId(manager) ?: run {
      Log.e(TAG, "No camera found for facing=$facing")
      return
    }

    manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
      override fun onOpened(camera: CameraDevice) {
        cameraDevice = camera
        startPreviewSession(camera)
      }
      override fun onDisconnected(camera: CameraDevice) {
        camera.close(); cameraDevice = null
      }
      override fun onError(camera: CameraDevice, error: Int) {
        camera.close(); cameraDevice = null
        Log.e(TAG, "Camera open error: $error")
      }
    }, backgroundHandler)
  }

  @Suppress("deprecation")
  private fun startPreviewSession(camera: CameraDevice) {
    val st = textureView.surfaceTexture ?: return
    st.setDefaultBufferSize(videoWidth, videoHeight)
    val previewSurface = Surface(st)

    camera.createCaptureSession(
      listOf(previewSurface),
      object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(session: CameraCaptureSession) {
          captureSession = session
          val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
            addTarget(previewSurface)
            set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
          }.build()
          session.setRepeatingRequest(request, null, backgroundHandler)
          applyPreviewTransform()
        }
        override fun onConfigureFailed(session: CameraCaptureSession) {
          Log.e(TAG, "Preview session configure failed")
        }
      },
      backgroundHandler
    )
  }

  // ---------- Recording ----------

  fun startRecording(promise: Promise) {
    if (isRecording) {
      promise.reject("ERR_ALREADY_RECORDING", "Already recording", null)
      return
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.reject("ERR_API_LEVEL", "Seamless recording requires Android 8.0 (API 26) or higher", null)
      return
    }

    try {
      chunkIndex = 0
      currentChunkFile = createChunkFile(0)

      setupMediaRecorder(currentChunkFile!!)

      // Close preview-only session, then open recording session with both surfaces
      captureSession?.close()
      captureSession = null

      val camera = cameraDevice
      if (camera == null) {
        promise.reject("ERR_NO_CAMERA", "Camera not available", null)
        return
      }

      createRecordingSession(camera, promise)
    } catch (e: Exception) {
      Log.e(TAG, "startRecording failed", e)
      promise.reject("ERR_START", e.message ?: "Unknown error", e)
    }
  }

  private fun setupMediaRecorder(outputFile: File) {
    mediaRecorder = MediaRecorder().apply {
      setAudioSource(MediaRecorder.AudioSource.MIC)
      setVideoSource(MediaRecorder.VideoSource.SURFACE)
      setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      setVideoEncoder(MediaRecorder.VideoEncoder.H264)
      setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      setVideoSize(videoWidth, videoHeight)
      setVideoFrameRate(DEFAULT_FRAME_RATE)
      setVideoEncodingBitRate(DEFAULT_VIDEO_BITRATE)
      setAudioEncodingBitRate(DEFAULT_AUDIO_BITRATE)
      setMaxFileSize(DEFAULT_CHUNK_MAX_BYTES)
      setOutputFile(outputFile)
      setOrientationHint(getOrientationHint())

      setOnInfoListener { mr, what, _ ->
        when (what) {
          MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_APPROACHING -> {
            handleFileSizeApproaching(mr)
          }
          MediaRecorder.MEDIA_RECORDER_INFO_NEXT_OUTPUT_FILE_STARTED -> {
            handleNextFileStarted()
          }
          MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED -> {
            // Fires only if setNextOutputFile wasn't called in time — recording stops
            Log.w(TAG, "Max file size reached without next file; recording stopped")
            isRecording = false
            emitCurrentChunk()
            onError(mapOf("message" to "Recording stopped unexpectedly (max file size reached)"))
          }
        }
      }

      setOnErrorListener { _, what, extra ->
        Log.e(TAG, "MediaRecorder error: what=$what extra=$extra")
        isRecording = false
        onError(mapOf("message" to "MediaRecorder error: $what/$extra"))
      }

      prepare()
    }
  }

  private fun handleFileSizeApproaching(mr: MediaRecorder) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nextFile = createChunkFile(chunkIndex + 1)
    try {
      mr.setNextOutputFile(nextFile)
      Log.d(TAG, "setNextOutputFile → chunk_${chunkIndex + 1}")
    } catch (e: Exception) {
      Log.e(TAG, "setNextOutputFile failed", e)
      onError(mapOf("message" to "Failed to prepare next chunk: ${e.message}"))
    }
  }

  private fun handleNextFileStarted() {
    // The previous chunk is now complete and playable
    emitCurrentChunk()
    chunkIndex++
    currentChunkFile = createChunkFile(chunkIndex)
    Log.d(TAG, "Switched to chunk $chunkIndex")
  }

  @Suppress("deprecation")
  private fun createRecordingSession(camera: CameraDevice, promise: Promise) {
    val st = textureView.surfaceTexture ?: run {
      promise.reject("ERR_SURFACE", "Surface not ready", null)
      return
    }
    st.setDefaultBufferSize(videoWidth, videoHeight)
    val previewSurface = Surface(st)
    val recorderSurface = mediaRecorder!!.surface

    camera.createCaptureSession(
      listOf(previewSurface, recorderSurface),
      object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(session: CameraCaptureSession) {
          captureSession = session

          val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
            addTarget(previewSurface)
            addTarget(recorderSurface)
            set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
          }.build()

          session.setRepeatingRequest(request, null, backgroundHandler)

          mediaRecorder?.start()
          isRecording = true
          applyPreviewTransform()

          Log.d(TAG, "Recording started — chunk 0")
          promise.resolve(null)
        }

        override fun onConfigureFailed(session: CameraCaptureSession) {
          promise.reject("ERR_SESSION", "Failed to configure recording session", null)
        }
      },
      backgroundHandler
    )
  }

  fun stopRecording(promise: Promise) {
    if (!isRecording) {
      promise.resolve(null)
      return
    }
    isRecording = false

    try {
      mediaRecorder?.stop()
    } catch (e: RuntimeException) {
      // Can throw if recording was very short
      Log.w(TAG, "mediaRecorder.stop() threw", e)
    }

    // Emit the final (partial) chunk
    emitCurrentChunk()

    // Release recorder, then restart preview-only session
    releaseRecorder()

    val camera = cameraDevice
    if (camera != null) {
      startPreviewSession(camera)
    }

    Log.d(TAG, "Recording stopped after ${chunkIndex + 1} chunks")
    promise.resolve(null)
  }

  // ---------- Helpers ----------

  private fun emitCurrentChunk() {
    val file = currentChunkFile ?: return
    if (!file.exists() || file.length() == 0L) return
    onChunkReady(mapOf(
      "index" to chunkIndex,
      "uri" to Uri.fromFile(file).toString()
    ))
  }

  private fun createChunkFile(index: Int): File {
    val dir = File(appContext.cacheDirectory, "seamless_recorder")
    if (!dir.exists()) dir.mkdirs()
    return File(dir, "chunk_${String.format("%03d", index)}.mp4")
  }

  private fun findCameraId(manager: CameraManager): String? {
    val targetFacing = if (facing == "front")
      CameraCharacteristics.LENS_FACING_FRONT
    else
      CameraCharacteristics.LENS_FACING_BACK

    return manager.cameraIdList.firstOrNull { id ->
      val chars = manager.getCameraCharacteristics(id)
      chars.get(CameraCharacteristics.LENS_FACING) == targetFacing
    }
  }

  private fun getOrientationHint(): Int {
    val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    val cameraId = findCameraId(manager) ?: return 0
    val chars = manager.getCameraCharacteristics(cameraId)
    val sensorOrientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
    // For front camera in portrait, typically sensor is 270°
    // For back camera in portrait, typically sensor is 90°
    return sensorOrientation
  }

  private fun applyPreviewTransform() {
    val viewWidth = textureView.width.toFloat()
    val viewHeight = textureView.height.toFloat()
    if (viewWidth == 0f || viewHeight == 0f) return

    val matrix = Matrix()

    // Camera sensor outputs landscape; rotate to portrait
    val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    val cameraId = findCameraId(manager) ?: return
    val chars = manager.getCameraCharacteristics(cameraId)
    val sensorOrientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0

    // Center the transform
    matrix.postTranslate(-viewWidth / 2f, -viewHeight / 2f)

    // Mirror for front camera
    if (facing == "front") {
      matrix.postScale(-1f, 1f)
    }

    matrix.postTranslate(viewWidth / 2f, viewHeight / 2f)

    textureView.setTransform(matrix)
  }

  // ---------- Lifecycle ----------

  private fun startBackgroundThread() {
    if (backgroundThread != null) return
    backgroundThread = HandlerThread("SeamlessRecorderBg").also { it.start() }
    backgroundHandler = Handler(backgroundThread!!.looper)
  }

  private fun stopBackgroundThread() {
    backgroundThread?.quitSafely()
    try { backgroundThread?.join() } catch (_: InterruptedException) {}
    backgroundThread = null
    backgroundHandler = null
  }

  private fun releaseRecorder() {
    try {
      mediaRecorder?.release()
    } catch (_: Exception) {}
    mediaRecorder = null
  }

  private fun releaseCamera() {
    captureSession?.close(); captureSession = null
    cameraDevice?.close(); cameraDevice = null
  }

  private fun releaseAll() {
    if (isRecording) {
      isRecording = false
      try { mediaRecorder?.stop() } catch (_: Exception) {}
    }
    releaseRecorder()
    releaseCamera()
    stopBackgroundThread()
  }
}
