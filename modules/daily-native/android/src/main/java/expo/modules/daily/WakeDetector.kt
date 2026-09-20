package expo.modules.daily

import ai.picovoice.porcupine.Porcupine
import ai.picovoice.porcupine.PorcupineException
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Process
import android.util.Log
import java.io.File

private const val TAG = "DailyWake"

/** 1つの言語モデルで動く Porcupine と、そのキーワード名（検出した番号 → 名前の対応） */
class WakeEngine(val porcupine: Porcupine, val labels: List<String>)

/**
 * Picovoice Porcupine（端末内・専用の待機語エンジン）を用意する。
 *
 * 待機語（.ppn）は Picovoice の API で「フレーズから」学習して端末内に保存する。初回だけネット接続が必要。
 *   - 日本語モデル: 「デイリー」「ヘイ デイリー」
 *   - 英語モデル : "hey daily"
 * 言語モデル(.pv)ごとに Porcupine インスタンスが1つ必要なので、日本語と英語の2つを並べて動かす。
 */
object WakeEngineFactory {

  // 呼びかけ候補: 先頭が本命。学習に失敗したら次の表記（ひらがな等）で試す
  private class Spec(val lang: String, val phrases: List<List<String>>, val modelAsset: String?)

  private val SPECS = listOf(
    Spec(
      "ja",
      listOf(listOf("デイリー", "でいりー"), listOf("ヘイ デイリー", "へい でいりー")),
      "porcupine_params_ja.pv" // assets に置く（CI が自動で配置）
    ),
    Spec("en", listOf(listOf("hey daily")), null) // 英語モデルは SDK に同梱
  )

  /** ブロッキング（ネットワークを使う）。バックグラウンドスレッドから呼ぶ。作れたエンジンだけ返す。 */
  fun build(ctx: Context, accessKey: String, report: (String) -> Unit): List<WakeEngine> {
    val dir = File(ctx.filesDir, "porcupine").apply { mkdirs() }
    val out = ArrayList<WakeEngine>()
    for (spec in SPECS) {
      try {
        buildOne(ctx, accessKey, dir, spec)?.let { out.add(it) }
      } catch (e: Throwable) {
        Log.w(TAG, "engine ${spec.lang} failed", e)
        report("${spec.lang}: ${e.message ?: e.javaClass.simpleName}")
      }
    }
    return out
  }

  private fun buildOne(ctx: Context, key: String, dir: File, spec: Spec): WakeEngine? {
    var attempt = 0
    while (true) {
      val paths = ArrayList<String>()
      val labels = ArrayList<String>()
      for (cands in spec.phrases) {
        val f = ensureKeyword(key, dir, spec.lang, cands, force = attempt > 0) ?: continue
        paths.add(f.absolutePath)
        labels.add(cands[0])
      }
      if (paths.isEmpty()) return null
      try {
        val builder = Porcupine.Builder()
          .setAccessKey(key)
          .setKeywordPaths(paths.toTypedArray())
          .setSensitivities(FloatArray(paths.size) { 0.6f }) // 既定 0.5 より少し聞き逃しにくく
        spec.modelAsset?.let { builder.setModelPath(it) }
        return WakeEngine(builder.build(ctx), labels)
      } catch (e: PorcupineException) {
        // 待機語ファイルの期限切れ・破損の可能性 → 1回だけ作り直す
        attempt += 1
        if (attempt >= 2) throw e
      }
    }
  }

  private fun ensureKeyword(key: String, dir: File, lang: String, cands: List<String>, force: Boolean): File? {
    val target = File(dir, "${lang}_${Integer.toHexString(cands[0].hashCode())}.ppn")
    if (!force && target.exists() && target.length() > 0) return target
    target.delete()
    for (phrase in cands) {
      val tmp = File(dir, target.name + ".tmp")
      try {
        Porcupine.trainWakeWordFromPhrase(key, tmp.absolutePath, lang, phrase)
        if (tmp.exists() && tmp.length() > 0 && tmp.renameTo(target)) return target
      } catch (e: PorcupineException) {
        Log.w(TAG, "train failed lang=$lang phrase=$phrase", e)
      } finally {
        tmp.delete()
      }
    }
    return null
  }
}

/**
 * マイクを読み続けて Porcupine に渡す。検出したらマイクを手放して onDetected を呼ぶ
 * （直後に SpeechRecognizer が指示を聞き取るため、マイクを取り合わないようにする）。
 */
class WakeDetector(
  private val engines: List<WakeEngine>,
  private val onDetected: (String) -> Unit,
  private val onFailure: () -> Unit
) {
  @Volatile private var running = false
  private var thread: Thread? = null

  fun start() {
    if (running) return
    thread?.join(300)
    running = true
    thread = Thread({ loop() }, "daily-wake").also { it.start() }
  }

  /** ノンブロッキング。スレッドが自分でマイクを解放して終わる。 */
  fun stop() {
    running = false
  }

  fun close() {
    running = false
    thread?.join(500)
    thread = null
    engines.forEach {
      try {
        it.porcupine.delete()
      } catch (e: Exception) {
        // ignore
      }
    }
  }

  private fun loop() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val frameLength = engines[0].porcupine.frameLength
    val sampleRate = engines[0].porcupine.sampleRate
    val minBuf = AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val bufBytes = maxOf(minBuf, frameLength * 2 * 4)

    var record: AudioRecord? = null
    try {
      record = AudioRecord(
        MediaRecorder.AudioSource.MIC, sampleRate,
        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufBytes
      )
      if (record.state != AudioRecord.STATE_INITIALIZED) throw IllegalStateException("AudioRecord init failed")
      record.startRecording()

      val frame = ShortArray(frameLength)
      while (running) {
        var read = 0
        while (read < frameLength && running) {
          val n = record.read(frame, read, frameLength - read)
          if (n < 0) throw IllegalStateException("AudioRecord.read = $n")
          read += n
        }
        if (!running) break
        for (e in engines) {
          val idx = e.porcupine.process(frame)
          if (idx >= 0) {
            running = false
            onDetected(e.labels.getOrElse(idx) { "daily" })
            return
          }
        }
      }
    } catch (e: Throwable) {
      // 他のアプリがマイクを使用中など。呼び出し側が少し待って再試行する
      Log.w(TAG, "detector loop failed", e)
      if (running) {
        running = false
        onFailure()
      }
    } finally {
      try {
        record?.stop()
      } catch (e: Exception) {
        // ignore
      }
      record?.release()
    }
  }
}
