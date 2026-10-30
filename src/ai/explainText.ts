// 回答文本的收尾处理:思考区剥离、半截话注脚、等不到字的超时话术。全是纯函数。

/**
 * 把回复里的思考区拆出来(纯函数,自测覆盖)。
 * 有的服务把思考装进单独的 reasoning_content 字段(llama-server 就这样);有的直接把
 * ` thinking…</think>` 掺在正文里(LM Studio 的部分后端)。后者在这里拆干净:
 * 有收尾标签 → 标签里是思考、后面是正文;没写收尾(半截话/字数烧尽)→ 全算思考。
 * 普通回复一根标签都没有,原样通过。
 */
export function splitThinking(text: string): { reasoning: string; answer: string } {
  const open = text.indexOf('<think>')
  if (open === -1) return { reasoning: '', answer: text }
  const close = text.indexOf('</think>', open)
  if (close === -1) return { reasoning: text.slice(open + 7).trim(), answer: '' }
  const reasoning = text.slice(open + 7, close).trim()
  const before = text.slice(0, open).trim()
  const after = text.slice(close + 8).trim()
  return { reasoning, answer: `${before}${before && after ? '\n\n' : ''}${after}` }
}

/** 到手的半截话配的注脚(纯函数,自测覆盖):断线/掐断/卡住各有各的说法 */
export function halfNote(kind: 'stall' | 'disconnect' | 'watchdog'): string {
  if (kind === 'disconnect') return '连接中断，以上为已生成内容'
  if (kind === 'watchdog') return '等待超时，以上为已生成内容'
  return '回答中断，重试可重新生成'
}

/** 等不到任何输出的超时话术(纯函数,自测覆盖) */
export function timeoutText(): string {
  return '等待超时，减少参考材料后重试'
}
