/**
 * mulberry32 确定性伪随机数,返回 [0, 1)。
 * 不用 Math.random:Louvain 的随机游走顺序会影响切分结果,固定种子才能让同一份代码每次切得一样。
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
