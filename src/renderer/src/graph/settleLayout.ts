// 力导向布局的同步预跑:打开或切换层级时,先在首帧之前把模拟跑到接近稳定,
// 让第一眼看到的就是最终布局与最终缩放比例,不再出现「先小后大」的一下缩放。纯函数,不依赖 DOM。

/** d3-force 模拟中预跑用到的最小接口(tick() 不触发 tick 事件,不会引起重绘) */
export interface Tickable {
  alpha: () => number
  tick: () => unknown
}

/** 一直 tick 到热度低于 threshold 或达到 maxTicks;返回实际步数 */
export function settleLayout(sim: Tickable, threshold: number, maxTicks: number): number {
  let ticks = 0
  while (sim.alpha() >= threshold && ticks < maxTicks) {
    sim.tick()
    ticks++
  }
  return ticks
}
