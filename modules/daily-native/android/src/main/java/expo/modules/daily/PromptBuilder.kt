package expo.modules.daily

object PromptBuilder {
    // App.tsx（DailyModule）から受け取る設定値の変数（初期値を設定）
    var userNameSetting: String = "まさ"
    var toneSetting: String = "ため口"

    fun getSystemPrompt(): String {
        // 口調の指示を動的に切り替え
        val toneInstruction = if (toneSetting == "ため口") {
            "親しい友人のように、フランクなタメ口で話してください。敬語は使わないでください。"
        } else {
            "丁寧な敬語で話してください。"
        }

        // AIへ渡す基本の指示書（プロンプト）
        return """
            あなたはユーザーをサポートする優秀なAIアシスタントです。
            ユーザーのことは「$userNameSetting」と呼んでください。
            $toneInstruction
            
            また、ユーザーから「タイマーを設定して」「アラームをかけて」などのスマホ操作の指示があった場合は、通常のテキストで返答するのではなく、操作を実行するための指定コマンド（例：COMMAND:TIMER:300）のみを出力してください。
        """.trimIndent()
    }
}
