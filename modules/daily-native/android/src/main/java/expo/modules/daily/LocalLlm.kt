package expo.modules.daily

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.ThinkingConfig

/**
 * 端末内AI（Gemma 4 E2B）で返事を作る。LiteRT-LM（Google AI Edge Gallery と同じ仕組み）を使う。
 * モデルは約2.5GBあるので、使っていないと5分で解放してメモリを空ける。
 */
object LocalLlm {

  private const val IDLE_RELEASE_MS = 5 * 60 * 1000L

  private var engine: Engine? = null
  private var useGpu = true // GPUで失敗したらCPUに切り替える
  private val handler = Handler(Looper.getMainLooper())
  private val releaseRunnable = Runnable { Thread { release() }.start() }

  /** ブロッキング（数秒かかる）。バックグラウンドスレッドから呼ぶこと */
  @Synchronized
  fun ask(ctx: Context, systemPrompt: String, history: List<GeminiClient.Turn>): String {
    handler.removeCallbacks(releaseRunnable)
    try {
      return try {
        generate(ctx, systemPrompt, history)
      } catch (t: Throwable) {
        if (!useGpu) throw t
        // GPUで失敗（画面オフ中など）→ CPUで作り直して1回だけやり直す
        useGpu = false
        closeEngine()
        generate(ctx, systemPrompt, history)
      }
    } catch (t: Throwable) {
      throw GeminiClient.GeminiException("端末内AIでエラーが起きました。", (t.message ?: t.javaClass.simpleName).take(160))
    } finally {
      handler.postDelayed(releaseRunnable, IDLE_RELEASE_MS)
    }
  }

  @Synchronized
  fun release() {
    closeEngine()
  }

  private fun closeEngine() {
    try {
      engine?.close()
    } catch (ignored: Throwable) {
      // ignore
    }
    engine = null
  }

  private fun generate(ctx: Context, systemPrompt: String, history: List<GeminiClient.Turn>): String {
    val eng = engine ?: createEngine(ctx).also { engine = it }

    val last = history.lastOrNull { it.role == "user" } ?: throw IllegalArgumentException("empty history")
    // 直前までの会話（最大8件、user から始める）を文脈として渡し、最後の発話だけを送る
    val prior = history.dropLast(1).takeLast(8).dropWhile { it.role != "user" }

    val config = ConversationConfig(
      systemInstruction = Contents.of(systemPrompt),
      initialMessages = prior.map { if (it.role == "user") Message.user(it.text) else Message.model(it.text) },
      samplerConfig = SamplerConfig(topK = 40, topP = 0.95, temperature = 0.8),
      thinkingConfig = ThinkingConfig(enableThinking = false), // 声で話す用途なので考えすぎない
      maxOutputToken = 256
    )
    return eng.createConversation(config).use { conversation ->
      conversation.sendMessage(last.text).toString().trim()
    }
  }

  private fun createEngine(ctx: Context): Engine {
    val path = LocalModel.file(ctx).absolutePath
    val backends: List<() -> Backend> =
      if (useGpu) listOf({ Backend.GPU() }, { Backend.CPU() }) else listOf({ Backend.CPU() })

    var lastError: Throwable? = null
    for (make in backends) {
      var e: Engine? = null
      try {
        e = Engine(EngineConfig(modelPath = path, backend = make(), cacheDir = ctx.cacheDir.absolutePath))
        e.initialize()
        return e
      } catch (t: Throwable) {
        lastError = t
        try {
          e?.close()
        } catch (ignored: Throwable) {
          // ignore
        }
      }
    }
    throw IllegalStateException(lastError?.message ?: "端末内AIを起動できません")
  }
}
