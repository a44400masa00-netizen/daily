package expo.modules.daily

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** アプリが閉じていても使えるよう、Gemini API (generateContent) をネイティブから直接呼ぶ。 */
object GeminiClient {

  class GeminiException(message: String) : Exception(message)

  data class Turn(val role: String, val text: String) // role: "user" | "model"

  private const val ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"

  /** ブロッキング呼び出し。必ずバックグラウンドスレッドから呼ぶこと。 */
  fun ask(apiKey: String, model: String, systemPrompt: String, history: List<Turn>): String {
    val contents = JSONArray()
    history.forEach { t ->
      contents.put(
        JSONObject()
          .put("role", t.role)
          .put("parts", JSONArray().put(JSONObject().put("text", t.text)))
      )
    }
    val generationConfig = JSONObject()
    // Gemini 3.x は thinkingLevel で思考量を調整（音声会話は速さ重視で low）
    if (model.startsWith("gemini-3")) {
      generationConfig.put("thinkingConfig", JSONObject().put("thinkingLevel", "low"))
    }
    val body = JSONObject()
      .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", systemPrompt))))
      .put("contents", contents)
      .put("generationConfig", generationConfig)

    val url = URL("$ENDPOINT/${URLEncoder.encode(model, "UTF-8")}:generateContent")
    val conn = url.openConnection() as HttpURLConnection
    try {
      conn.requestMethod = "POST"
      conn.connectTimeout = 15_000
      conn.readTimeout = 30_000
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/json")
      conn.setRequestProperty("x-goog-api-key", apiKey)
      conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }

      val code = conn.responseCode
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      val raw = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
      if (code !in 200..299) throw GeminiException(friendlyError(code, raw))

      val json = JSONObject(raw)
      if (json.optJSONObject("promptFeedback")?.has("blockReason") == true) {
        throw GeminiException("その内容にはお答えできませんでした。")
      }
      val parts = json.optJSONArray("candidates")
        ?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")
      val sb = StringBuilder()
      if (parts != null) {
        for (i in 0 until parts.length()) {
          val p = parts.optJSONObject(i) ?: continue
          if (p.optBoolean("thought", false)) continue
          sb.append(p.optString("text", ""))
        }
      }
      val text = sb.toString().trim()
      if (text.isEmpty()) throw GeminiException("うまく回答を作れませんでした。もう一度話しかけてください。")
      return text
    } catch (e: GeminiException) {
      throw e
    } catch (e: IOException) {
      throw GeminiException("通信に失敗しました。ネットワークを確認してください。")
    } finally {
      conn.disconnect()
    }
  }

  private fun friendlyError(status: Int, raw: String): String {
    val detail = try {
      JSONObject(raw).optJSONObject("error")?.optString("message", "") ?: ""
    } catch (e: Exception) {
      raw.take(120)
    }
    return when (status) {
      400 -> if (detail.contains("API key", ignoreCase = true)) "APIキーが正しくありません。アプリの設定を確認してください。" else "リクエストエラーです。"
      401, 403 -> "APIキーが無効か、権限がありません。アプリの設定を確認してください。"
      404 -> "モデルが見つかりません。アプリの設定でモデル名を確認してください。"
      429 -> "利用上限に達したか、混み合っています。少し待ってからお試しください。"
      else -> "Gemini APIでエラーが起きました。"
    }
  }
}
