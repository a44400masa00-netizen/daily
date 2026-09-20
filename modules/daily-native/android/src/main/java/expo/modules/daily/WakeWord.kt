package expo.modules.daily

/**
 * 音声認識の文字列から「デイリー」の呼びかけを見つけ、その後ろの指示文を取り出す。
 * カタカナ→ひらがな、大文字→小文字、空白/記号の除去をしてから比較する。
 */
object WakeWord {

  // 正規化後（ひらがな・小文字）の表記ゆれ
  private val WORDS = listOf("でいりー", "でいりい", "でぃりー", "でぃりい", "daily")

  // 呼びかけの前に付けてよい文字数（「ねえ」「へい」「おっけー」などを許容）
  private const val MAX_PREFIX = 6

  private const val TRIM_CHARS = "、。,.!！?？"

  private fun normalizeChar(ch: Char): Char? {
    val code = ch.code
    return when {
      code in 0x30A1..0x30F6 -> (code - 0x60).toChar() // カタカナ → ひらがな
      ch == 'ー' -> ch
      ch.isLetterOrDigit() -> ch.lowercaseChar()
      else -> null // 空白・記号は捨てる
    }
  }

  /**
   * 呼びかけが含まれていれば、その後ろの指示文（無ければ空文字）を返す。含まれていなければ null。
   */
  fun extractCommand(raw: String): String? {
    val norm = StringBuilder()
    val rawIndex = ArrayList<Int>()
    raw.forEachIndexed { i, ch ->
      val n = normalizeChar(ch)
      if (n != null) {
        norm.append(n)
        rawIndex.add(i)
      }
    }
    val s = norm.toString()

    var bestPos = -1
    var bestLen = 0
    for (w in WORDS) {
      val p = s.indexOf(w)
      if (p in 0..MAX_PREFIX && (bestPos == -1 || p < bestPos || (p == bestPos && w.length > bestLen))) {
        bestPos = p
        bestLen = w.length
      }
    }
    if (bestPos == -1) return null

    val rawEnd = rawIndex[bestPos + bestLen - 1] + 1
    return raw.substring(rawEnd).trim { it.isWhitespace() || it in TRIM_CHARS }
  }

  // 会話を終える言葉（正規化後）。「デイリー」と一緒に言われたときだけ有効
  private val END_WORDS = listOf("戻って", "もどって", "戻ろう", "もどろう", "終了", "終わり", "おわり", "おしまい", "もういい")

  private fun normalizeAll(raw: String): String {
    val sb = StringBuilder()
    raw.forEach { ch -> normalizeChar(ch)?.let { sb.append(it) } }
    return sb.toString()
  }

  /** 「デイリー戻って」「デイリー戻っていいよ」など、会話を終える呼びかけか */
  fun isEndCommand(raw: String): Boolean {
    val s = normalizeAll(raw)
    if (WORDS.none { s.contains(it) }) return false // 「デイリー」が無ければ普通の会話として扱う
    return END_WORDS.any { s.contains(it) }
  }
}
