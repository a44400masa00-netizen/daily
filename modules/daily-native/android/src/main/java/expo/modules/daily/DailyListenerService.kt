package expo.modules.daily

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * 「デイリー」と呼びかけると起動する常駐サービス（マイク型フォアグラウンドサービス）。
 *
 *  待機(WAKE) ──「デイリー」──▶ 指示待ち(COMMAND) or そのまま処理 ──▶ 処理中(BUSY: Gemini→読み上げ) ──▶ 待機
 *
 * アプリ(JS)が閉じていても動くよう、音声認識・Gemini 呼び出し・読み上げをすべてネイティブで行う。
 */
class DailyListenerService : Service() {

  private enum class Phase { WAKE, COMMAND, BUSY }

  private val main = Handler(Looper.getMainLooper())
  private val worker: ExecutorService = Executors.newSingleThreadExecutor()

  private var recognizer: SpeechRecognizer? = null
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private var wakeLock: PowerManager.WakeLock? = null
  private lateinit var audio: AudioManager
  private var focusRequest: AudioFocusRequest? = null
  private val focusListener = AudioManager.OnAudioFocusChangeListener { }

  private var phase = Phase.WAKE
  private var externalPause = false // アプリ画面で会話中は待機を止める
  private var stopped = false
  private var cleanedUp = false
  private var useOnDevice = Build.VERSION.SDK_INT >= 33
  private var consecutiveErrors = 0
  private var commandDeadline = 0L

  // Picovoice Porcupine による呼びかけ検出（準備できるまで／未設定なら SpeechRecognizer で代用）
  private val prep: ExecutorService = Executors.newSingleThreadExecutor()
  private var wakeDetector: WakeDetector? = null

  // 会話履歴（worker スレッドからのみ触る）
  private val history = ArrayList<GeminiClient.Turn>()
  private var lastInteraction = 0L

  private val restartRunnable = Runnable { startListening() }

  // ---- ライフサイクル -----------------------------------------------------------

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    createChannel()
    initTts()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      startForegroundCompat(IDLE_TEXT)
    } catch (e: Exception) {
      // マイク許可が無い / バックグラウンドから起動された等
      DailyBus.emit("onMessage", mapOf("role" to "error", "text" to "常時待機を開始できませんでした: ${e.message}"))
      shutdown()
      return START_NOT_STICKY
    }
    if (!running) {
      running = true
      acquireWakeLock()
      emitState("listening")
      scheduleRestart(0)
      prepareWake()
    }
    // 強制終了後に勝手に再起動されない（バックグラウンドからのマイク起動は Android が禁止しているため）
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    cleanup()
    super.onDestroy()
  }

  private fun shutdown() {
    cleanup()
    @Suppress("DEPRECATION")
    stopForeground(true)
    stopSelf()
  }

  private fun cleanup() {
    if (cleanedUp) return
    cleanedUp = true
    stopped = true
    running = false
    instance = null
    main.removeCallbacksAndMessages(null)
    wakeDetector?.close()
    wakeDetector = null
    prep.shutdownNow()
    destroyRecognizer()
    tts?.stop()
    tts?.shutdown()
    tts = null
    abandonFocus()
    worker.shutdownNow()
    try {
      wakeLock?.let { if (it.isHeld) it.release() }
    } catch (e: Exception) {
      // ignore
    }
    wakeLock = null
    emitState("stopped")
  }

  // ---- 外部（JS）からの操作 -------------------------------------------------------

  /** アプリ画面での会話中は待機を止め、終わったら再開する */
  fun setExternalPause(paused: Boolean) {
    if (stopped || externalPause == paused) return
    externalPause = paused
    if (paused) {
      main.removeCallbacks(restartRunnable)
      wakeDetector?.stop()
      destroyRecognizer()
      emitState("paused")
    } else if (phase != Phase.BUSY) {
      phase = Phase.WAKE
      emitState("listening")
      scheduleRestart(400)
    }
  }

  // ---- 音声認識 -----------------------------------------------------------------

  private fun createRecognizer(): SpeechRecognizer? {
    val r: SpeechRecognizer? = when {
      useOnDevice && Build.VERSION.SDK_INT >= 33 &&
        SpeechRecognizer.isOnDeviceRecognitionAvailable(this) ->
        SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
      SpeechRecognizer.isRecognitionAvailable(this) -> SpeechRecognizer.createSpeechRecognizer(this)
      else -> null
    }
    r?.setRecognitionListener(listener)
    return r
  }

  private fun destroyRecognizer() {
    try {
      recognizer?.cancel()
      recognizer?.destroy()
    } catch (e: Exception) {
      // ignore
    }
    recognizer = null
  }

  private fun scheduleRestart(delayMs: Long) {
    main.removeCallbacks(restartRunnable)
    if (stopped) return
    main.postDelayed(restartRunnable, delayMs)
  }

  private fun startListening() {
    if (stopped || externalPause || phase == Phase.BUSY) return
    // 呼びかけ待ちは Porcupine（専用エンジン）が使えるならそちらで。指示の聞き取りだけ SpeechRecognizer を使う
    if (phase == Phase.WAKE) {
      val detector = wakeDetector
      if (detector != null) {
        destroyRecognizer()
        detector.start()
        return
      }
    }
    if (recognizer == null) recognizer = createRecognizer()
    val r = recognizer
    if (r == null) {
      DailyBus.emit("onMessage", mapOf("role" to "error", "text" to "この端末では音声認識を利用できません。"))
      shutdown()
      return
    }
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ja-JP")
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
    }
    try {
      r.startListening(intent)
    } catch (e: Exception) {
      destroyRecognizer()
      scheduleRestart(1_000)
    }
  }

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(rmsdB: Float) {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onPartialResults(partialResults: Bundle?) {}
    override fun onEvent(eventType: Int, params: Bundle?) {}

    override fun onResults(results: Bundle?) {
      val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        ?.filterNotNull() ?: emptyList()
      handleResults(list)
    }

    override fun onError(error: Int) {
      handleError(error)
    }
  }

  private fun handleResults(candidates: List<String>) {
    if (stopped || externalPause) return
    consecutiveErrors = 0
    when (phase) {
      Phase.WAKE -> {
        for (c in candidates) {
          val cmd = WakeWord.extractCommand(c)
          if (cmd != null) {
            onWake(cmd)
            return
          }
        }
        scheduleRestart(150) // 呼びかけ無し: 何も送らず捨てて待機を続ける
      }
      Phase.COMMAND -> {
        val first = candidates.firstOrNull()?.trim().orEmpty()
        if (first.isEmpty()) {
          if (System.currentTimeMillis() > commandDeadline) {
            phase = Phase.WAKE // 指示が来ないまま時間切れ → 呼びかけ待ちに戻る
            updateNotification(IDLE_TEXT)
            emitState("listening")
          }
          scheduleRestart(150)
        } else {
          // 「デイリー、〇〇」と言い直された場合は呼びかけ部分を外す
          val text = WakeWord.extractCommand(first)?.takeIf { it.isNotEmpty() } ?: first
          processCommand(text)
        }
      }
      Phase.BUSY -> Unit
    }
  }

  private fun handleError(code: Int) {
    if (stopped || externalPause) return
    when (code) {
      SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> {
        // 無音は普通のこと。指示待ちが時間切れなら待機に戻す
        if (phase == Phase.COMMAND && System.currentTimeMillis() > commandDeadline) {
          phase = Phase.WAKE
          updateNotification(IDLE_TEXT)
          emitState("listening")
        }
        scheduleRestart(200)
      }
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> {
        destroyRecognizer()
        scheduleRestart(1_000)
      }
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
        DailyBus.emit("onMessage", mapOf("role" to "error", "text" to "マイクの許可がありません。設定を確認してください。"))
        shutdown()
      }
      12, 13 -> { // ERROR_LANGUAGE_NOT_SUPPORTED / ERROR_LANGUAGE_UNAVAILABLE
        if (useOnDevice) {
          useOnDevice = false // 端末内モデルが無い → 通常の認識サービスに切り替える
          destroyRecognizer()
          scheduleRestart(300)
        } else {
          DailyBus.emit("onMessage", mapOf("role" to "error", "text" to "日本語の音声認識を利用できません。"))
          shutdown()
        }
      }
      else -> {
        // ネットワーク/サーバ/クライアント/音声入力エラー: 指数バックオフで再試行
        consecutiveErrors += 1
        val delay = minOf(30_000L, 1_000L shl minOf(consecutiveErrors, 5))
        destroyRecognizer()
        scheduleRestart(delay)
      }
    }
  }

  // ---- Porcupine（呼びかけ検出） -----------------------------------------------------------

  private fun prepareWake() {
    val key = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("picovoice_key", "").orEmpty()
    if (key.isBlank()) {
      DailyBus.emit(
        "onMessage",
        mapOf(
          "role" to "error",
          "text" to "Picovoice AccessKey が未設定のため、簡易の呼びかけ検出で動いています（精度・電池消費が劣ります）。設定で入力すると専用エンジンに切り替わります。"
        )
      )
      return
    }
    updateNotification("呼びかけの準備中…（初回はネット接続が必要です）")
    prep.execute {
      val problems = ArrayList<String>()
      val engines = try {
        WakeEngineFactory.build(applicationContext, key) { problems.add(it) }
      } catch (e: Throwable) {
        problems.add(e.message ?: e.javaClass.simpleName)
        emptyList()
      }
      main.post {
        if (stopped || engines.isEmpty()) {
          engines.forEach { it.porcupine.delete() }
          if (!stopped) {
            updateNotification(IDLE_TEXT)
            DailyBus.emit(
              "onMessage",
              mapOf(
                "role" to "error",
                "text" to "呼びかけの専用エンジンを準備できなかったので、簡易検出で動きます。(${problems.joinToString(" / ")})"
              )
            )
          }
          return@post
        }
        if (problems.isNotEmpty()) {
          DailyBus.emit(
            "onMessage",
            mapOf("role" to "error", "text" to "一部の呼びかけを準備できませんでした。(${problems.joinToString(" / ")})")
          )
        }
        wakeDetector = WakeDetector(
          engines,
          onDetected = { main.post { onPorcupineDetected() } },
          onFailure = { main.post { onDetectorFailure() } }
        )
        updateNotification(IDLE_TEXT)
        if (phase == Phase.WAKE && !externalPause) {
          destroyRecognizer() // 簡易検出から専用エンジンへ切り替え
          scheduleRestart(0)
        }
      }
    }
  }

  private fun onPorcupineDetected() {
    if (stopped || externalPause || phase != Phase.WAKE) return
    consecutiveErrors = 0
    onWake("") // 合図音 → 指示の聞き取りへ
  }

  private fun onDetectorFailure() {
    if (stopped || externalPause || phase != Phase.WAKE) return
    consecutiveErrors += 1
    scheduleRestart(minOf(30_000L, 1_000L shl minOf(consecutiveErrors, 5))) // マイクが空くまで待って再試行
  }

  // ---- 呼びかけ → 指示 → 応答 ---------------------------------------------------------

  private fun onWake(command: String) {
    if (command.isBlank()) {
      // 「デイリー」だけ言われた: 合図を鳴らして続きを聞く
      phase = Phase.COMMAND
      commandDeadline = System.currentTimeMillis() + 9_000
      chime()
      updateNotification("どうぞ、話してください")
      emitState("awake")
      scheduleRestart(350)
    } else {
      processCommand(command)
    }
  }

  private fun processCommand(text: String) {
    phase = Phase.BUSY
    main.removeCallbacks(restartRunnable)
    destroyRecognizer()
    updateNotification("考え中…")
    emitState("thinking")
    DailyBus.emit("onMessage", mapOf("role" to "user", "text" to text))

    worker.execute {
      val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val apiKey = prefs.getString("api_key", "").orEmpty()
      val model = prefs.getString("model", "gemini-3.8-flash").orEmpty().ifBlank { "gemini-3.8-flash" }

      if (apiKey.isBlank()) {
        main.post { deliver("アプリを開いて、設定でジェミニのAPIキーを入れてください。", isError = true) }
        return@execute
      }

      val now = System.currentTimeMillis()
      if (now - lastInteraction > IDLE_RESET_MS) history.clear() // しばらく間が空いたら文脈をリセット
      lastInteraction = now
      history.add(GeminiClient.Turn("user", text))

      try {
        val reply = GeminiClient.ask(apiKey, model, PromptBuilder.build(applicationContext), trimmedHistory())
        history.add(GeminiClient.Turn("model", reply))
        main.post { deliver(reply, isError = false) }
      } catch (e: Exception) {
        history.removeAt(history.size - 1) // 失敗したターンは履歴に残さない
        main.post { deliver(e.message ?: "エラーが起きました。", isError = true) }
      }
    }
  }

  private fun trimmedHistory(): List<GeminiClient.Turn> {
    val recent = history.takeLast(20).toMutableList()
    while (recent.isNotEmpty() && recent[0].role != "user") recent.removeAt(0)
    return recent
  }

  private fun deliver(text: String, isError: Boolean) {
    if (stopped) return
    DailyBus.emit("onMessage", mapOf("role" to if (isError) "error" else "model", "text" to text))
    val speakOn = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("speak", true)
    if (!speakOn || !ttsReady) {
      finishSpeaking()
      return
    }
    requestFocus()
    updateNotification("話しています…")
    emitState("speaking")
    tts?.speak(cleanForSpeech(text), TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ID)
  }

  private fun finishSpeaking() {
    abandonFocus()
    if (stopped) return
    phase = Phase.WAKE
    updateNotification(IDLE_TEXT)
    emitState("listening")
    if (!externalPause) scheduleRestart(400)
  }

  // ---- 読み上げ・合図・音声フォーカス ----------------------------------------------------

  private fun initTts() {
    tts = TextToSpeech(applicationContext) { status ->
      if (status == TextToSpeech.SUCCESS) {
        tts?.language = Locale.JAPAN
        tts?.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) {}
          override fun onDone(utteranceId: String?) {
            main.post { finishSpeaking() }
          }

          @Suppress("OVERRIDE_DEPRECATION")
          override fun onError(utteranceId: String?) {
            main.post { finishSpeaking() }
          }
        })
        ttsReady = true
      }
    }
  }

  private fun cleanForSpeech(text: String): String =
    text
      .replace(Regex("https?://\\S+"), "")
      .replace(Regex("[*_`#>~]"), "")
      .replace(Regex("[\\uD83C-\\uDBFF\\uDC00-\\uDFFF\\u2600-\\u27BF\\uFE0F]"), "")
      .replace(Regex("\\s+"), " ")
      .trim()
      .take(3_900)

  /** 他のアプリ(Instagram/LINE等)の音声を一時的に小さくして、デイリーの声を聞き取りやすくする */
  private fun requestFocus() {
    if (Build.VERSION.SDK_INT >= 26) {
      val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setOnAudioFocusChangeListener(focusListener)
        .build()
      audio.requestAudioFocus(req)
      focusRequest = req
    } else {
      @Suppress("DEPRECATION")
      audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
  }

  private fun abandonFocus() {
    if (!this::audio.isInitialized) return
    if (Build.VERSION.SDK_INT >= 26) {
      focusRequest?.let { audio.abandonAudioFocusRequest(it) }
      focusRequest = null
    } else {
      @Suppress("DEPRECATION")
      audio.abandonAudioFocus(focusListener)
    }
  }

  private fun chime() {
    try {
      val tg = ToneGenerator(AudioManager.STREAM_MUSIC, 70)
      tg.startTone(ToneGenerator.TONE_PROP_ACK, 150)
      main.postDelayed({ tg.release() }, 500)
    } catch (e: Exception) {
      // ignore
    }
  }

  // ---- 通知・WakeLock --------------------------------------------------------------

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= 26) {
      val ch = NotificationChannel(CHANNEL_ID, "デイリー待機中", NotificationManager.IMPORTANCE_LOW)
      ch.setShowBadge(false)
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
    }
  }

  @Suppress("DEPRECATION")
  private fun buildNotification(text: String): Notification {
    val open = packageManager.getLaunchIntentForPackage(packageName) ?: Intent()
    val openPi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    return builder
      .setContentTitle("デイリー")
      .setContentText(text)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentIntent(openPi)
      .setOngoing(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .build()
  }

  private fun startForegroundCompat(text: String) {
    val n = buildNotification(text)
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIF_ID, n)
    }
  }

  private fun updateNotification(text: String) {
    try {
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .notify(NOTIF_ID, buildNotification(text))
    } catch (e: Exception) {
      // ignore
    }
  }

  private fun acquireWakeLock() {
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "daily:listening").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun emitState(state: String) = DailyBus.emit("onState", mapOf("state" to state))

  companion object {
    const val PREFS = "daily_config"
    private const val CHANNEL_ID = "daily_listening"
    private const val NOTIF_ID = 4201
    private const val UTTERANCE_ID = "daily-utt"
    private const val IDLE_TEXT = "「デイリー」と呼びかけてください"
    private const val IDLE_RESET_MS = 10 * 60 * 1000L

    @Volatile var running = false
    @Volatile var instance: DailyListenerService? = null

    fun setPaused(paused: Boolean) {
      val s = instance ?: return
      s.main.post { s.setExternalPause(paused) }
    }
  }
}
