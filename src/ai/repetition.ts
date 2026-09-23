// ── 复读机防线(第一百四十三锤)──
// 小模型(9B 这档)回答时会陷入「复读机循环」:列举到一半,同一个短语开始无限重复
// (「system prompt、system message、system instruction、……」一屏望不到头)。
// 病根在采样层:模型逐词看着前文猜下一个,循环一旦偶然成型,「继续重复」就成了
// 概率最高的词,温度越低越死心塌地 —— 提示词喊「别重复」治不了肌肉痉挛。
// 这层防线两道闸:请求里带反重复采样参数(引擎层压概率,参数住在 shared/aiDefaults);
// 程序流式监工,发现尾巴在原地打转就当场掐断(上层管道接线,掐了重答)。
// 这里全是纯函数,自测在 scripts/selftest-ai.mts。

/** 判定复读所需的最少连续重复次数:4 连起步 —— 3 连可能是正常排比,放过 */
export const REPETITION_REPEATS = 4

/** 循环短语按字符数从头试到尾:6 字以下容易误伤正常排比,48 字以上已是天书 */
const PHRASE_MIN_CHARS = 6
const PHRASE_MAX_CHARS = 48

/** 循环短语必须有正经字(字母/汉字都行)参与:纯标点空白不算,长分隔线「------」会误触发 */
function hasRealChar(unit: string): boolean {
  return /[^\s\p{P}\p{S}]/u.test(unit)
}

/**
 * 看文本尾巴是不是陷入了复读机循环:同一个 6~48 字的短语,连着原样重复 4 次以上。
 * 只查尾巴 —— 正文里正常的排比、代码里的重复结构,只要后面还在往下写就不算;
 * 循环体的长度不一定是整字数,所以从 6 到 48 每个长度档都试一遍(总有一个档正好对齐)。
 * 犯了返回尾部那段循环切片,没犯返回 null。
 */
export function detectRepetitionTail(text: string): string | null {
  for (let n = PHRASE_MIN_CHARS; n <= PHRASE_MAX_CHARS; n++) {
    const unit = text.slice(-n)
    if (unit.length < n) break
    if (!hasRealChar(unit)) continue
    const window = text.slice(-n * REPETITION_REPEATS)
    if (window.length === n * REPETITION_REPEATS && window === unit.repeat(REPETITION_REPEATS))
      return unit
  }
  return null
}

/**
 * 把打转的部分掐掉:从检测出的循环窗口往回啃,找到这一串重复的最早起点,
 * 返回起点之前的正常内容。找不到循环(理论上不该发生,调用方都是先 detect 过)返回 null。
 */
export function truncateAtRepetition(text: string): string | null {
  for (let n = PHRASE_MIN_CHARS; n <= PHRASE_MAX_CHARS; n++) {
    const unit = text.slice(-n)
    if (unit.length < n) break
    if (!hasRealChar(unit)) continue
    const window = text.slice(-n * REPETITION_REPEATS)
    if (window.length !== n * REPETITION_REPEATS || window !== unit.repeat(REPETITION_REPEATS))
      continue
    let start = text.length - n * REPETITION_REPEATS
    while (start - n >= 0 && text.slice(start - n, start) === unit) start -= n
    return text.slice(0, start)
  }
  return null
}
