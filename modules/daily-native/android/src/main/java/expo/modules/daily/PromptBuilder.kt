package expo.modules.daily

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** サービス側（アプリが閉じていても動く）で使うシステムプロンプト。JS 側 src/usage.ts と同じ内容。 */
object PromptBuilder {

  /** 「あなたへの話しかけではない」と判断したときに返させる目印 */
  const val IGNORE_TOKEN = "[[IGNORE]]"

  private fun formatDuration(ms: Long): String {
    val totalMin = Math.round(ms / 60000.0).toInt()
    if (totalMin < 1) return "1分未満"
    val h = totalMin / 60
    val m = totalMin % 60
    return when {
      h == 0 -> "${m}分"
      m == 0 -> "${h}時間"
      else -> "${h}時間${m}分"
    }
  }

  private fun hhmm(ts: Long): String = SimpleDateFormat("H:mm", Locale.JAPAN).format(Date(ts))

  private fun describeUsage(ctx: Context): String {
    if (!UsageCollector.hasPermission(ctx)) {
      return "【スマホ使用状況】ユーザーがまだ「使用状況へのアクセス」を許可していないため取得できません。" +
        "使用状況について聞かれたら、アプリを開いて許可するとアドバイスできることを伝えてください。"
    }
    val u = try {
      UsageCollector.collectToday(ctx)
    } catch (e: Exception) {
      return "【スマホ使用状況】取得に失敗しました。使用状況の話題では、今は確認できないと伝えてください。"
    }
    val lines = ArrayList<String>()
    lines.add("【今日のスマホ使用状況（0:00〜${hhmm(u.now)}）】")
    lines.add("- 合計使用時間: ${formatDuration(u.totalMs)}（このアプリとホーム画面は除く）")
    lines.add("- 画面ONの回数: ${u.screenOnCount}回 / ロック解除: ${u.unlockCount}回")
    if (u.apps.isNotEmpty()) {
      lines.add("- アプリ別（使用時間の長い順）:")
      u.apps.take(8).forEach {
        lines.add("  ・${it.label}: ${formatDuration(it.totalMs)}、起動${it.launchCount}回、最終使用${hhmm(it.lastUsed)}")
      }
    }
    if (u.launches.isNotEmpty()) {
      val recent = u.launches.takeLast(12).joinToString(" → ") { "${hhmm(it.timestamp)} ${it.label}" }
      lines.add("- 直近に起動したアプリ（時系列）: $recent")
    }
    return lines.joinToString("\n")
  }

  fun build(ctx: Context): String {
    val now = SimpleDateFormat("yyyy年M月d日(E) H:mm", Locale.JAPAN).format(Date())
    return listOf(
      "あなたの名前は「デイリー」です。ユーザーと音声でおしゃべりする、親しみやすいAIアシスタントです。",
      "",
      "# 話し方のルール",
      "- 返答は音声で読み上げられます。自然な日本語の話し言葉で、1〜3文（100文字前後）で短く答えてください。",
      "- ユーザーはInstagramやLINEなど他のアプリを見ながら話しかけていることがあります。手短に答えてください。",
      "- 会話は続いています。ユーザーは毎回「デイリー」と呼ばずに話しかけてきます。",
      "- 動画・テレビ・周囲の人の声など、スマホのマイクが拾った音がそのまま届くことがあります。明らかにあなたへの話しかけではない（動画のセリフ、他の人との会話、独り言など）と判断したときだけ、返答を「$IGNORE_TOKEN」の一語だけにしてください。あなたへの質問・依頼・雑談の可能性が少しでもあれば、普通に答えてください。",
      "- Markdown、箇条書き、絵文字、記号、URLは使わないでください。",
      "- 相手の話に共感し、会話が続く軽い一言や質問を添えても構いません（毎回でなくてよい）。",
      "",
      "# スマホ使用状況の扱い",
      "- 下の使用状況は、端末から取得した今日の実データです。数字は正確に使い、データにないことは作らないでください。",
      "- ユーザーが使用状況を尋ねたときや、会話の流れで自然なときに、データに基づいて具体的にアドバイスしてください（使いすぎ、休憩、寝る前の使用、ついつい開いてしまうアプリ など）。",
      "- 説教くさくならず、責めないでください。うまく使えている点も伝えてください。",
      "- アプリの中で何をしていたかまでは分かりません。分からないことは分からないと答えてください。",
      "",
      "# 現在日時",
      now,
      "",
      describeUsage(ctx)
    ).joinToString("\n")
  }
}
