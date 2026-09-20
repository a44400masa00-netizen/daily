import type { TodayUsage } from '../modules/daily-native';

export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return '1分未満';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function describeNow(now: Date): string {
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日(${WEEKDAYS[now.getDay()]}) ${hhmm(now.getTime())}`;
}

/** Gemini に渡す「今日のスマホ使用状況」テキストを作る */
export function describeUsage(
  usage: TodayUsage | null,
  state: { available: boolean; permitted: boolean }
): string {
  if (!state.available) {
    return '【スマホ使用状況】この環境では取得できません（Androidの開発ビルド/APKでのみ取得可能）。';
  }
  if (!state.permitted) {
    return (
      '【スマホ使用状況】ユーザーがまだ「使用状況へのアクセス」を許可していないため取得できません。' +
      '使用状況について聞かれたら、許可するとアドバイスできることを伝えてください。'
    );
  }
  if (!usage) {
    return '【スマホ使用状況】取得に失敗しました。使用状況の話題では、今は確認できないと伝えてください。';
  }

  const lines: string[] = [];
  lines.push(`【今日のスマホ使用状況（0:00〜${hhmm(usage.now)}）】`);
  lines.push(`- 合計使用時間: ${formatDuration(usage.totalMs)}（このアプリとホーム画面は除く）`);
  lines.push(`- 画面ONの回数: ${usage.screenOnCount}回 / ロック解除: ${usage.unlockCount}回`);

  if (usage.apps.length > 0) {
    lines.push('- アプリ別（使用時間の長い順）:');
    for (const a of usage.apps.slice(0, 8)) {
      lines.push(
        `  ・${a.label}: ${formatDuration(a.totalMs)}、起動${a.launchCount}回、最終使用${hhmm(a.lastUsed)}`
      );
    }
  }

  if (usage.launches.length > 0) {
    const recent = usage.launches
      .slice(-12)
      .map((l) => `${hhmm(l.timestamp)} ${l.label}`)
      .join(' → ');
    lines.push(`- 直近に起動したアプリ（時系列）: ${recent}`);
  }
  return lines.join('\n');
}

export function buildSystemPrompt(
  usage: TodayUsage | null,
  state: { available: boolean; permitted: boolean },
  now: Date = new Date()
): string {
  return [
    'あなたの名前は「デイリー」です。ユーザーと音声でおしゃべりする、親しみやすいAIアシスタントです。',
    '',
    '# 話し方のルール',
    '- 返答は音声で読み上げられます。自然な日本語の話し言葉で、1〜3文（100文字前後）で短く答えてください。',
    '- ユーザーはInstagramやLINEなど他のアプリを見ながら話しかけていることがあります。手短に答えてください。',
    '- Markdown、箇条書き、絵文字、記号、URLは使わないでください。',
    '- 相手の話に共感し、会話が続く軽い一言や質問を添えても構いません（毎回でなくてよい）。',
    '',
    '# スマホ使用状況の扱い',
    '- 下の使用状況は、端末から取得した今日の実データです。数字は正確に使い、データにないことは作らないでください。',
    '- ユーザーが使用状況を尋ねたときや、会話の流れで自然なときに、データに基づいて具体的にアドバイスしてください（使いすぎ、休憩、寝る前の使用、ついつい開いてしまうアプリ など）。',
    '- 説教くさくならず、責めないでください。うまく使えている点も伝えてください。',
    '- アプリの中で何をしていたかまでは分かりません。分からないことは分からないと答えてください。',
    '',
    `# 現在日時\n${describeNow(now)}`,
    '',
    describeUsage(usage, state),
  ].join('\n');
}
