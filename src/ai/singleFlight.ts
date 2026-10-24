/**
 * 单飞闸门(纯函数,自测覆盖):同一时刻只放一个任务进场,
 * 后到的调用直接等同一份承诺 —— 哪怕参数不同(引擎一个 app 只养一份,
 * 后到的就地等第一份,不自己再拉)。任务收场(成或败)闸门自动放行。
 * 修的病:两个请求同秒到达时,旧的「先检查后启动」两头都看见引擎没起,
 * 各自 spawn 一份 llama-server,同一个模型往内存装两遍(实测一晚吃掉 29GB)。
 */
export function createSingleFlight<A extends unknown[], T>(
  task: (...args: A) => Promise<T>
): (...args: A) => Promise<T> {
  let inFlight: Promise<T> | null = null
  return (...args: A) => {
    if (inFlight) return inFlight
    const running = task(...args)
    inFlight = running
    const release = (): void => {
      if (inFlight === running) inFlight = null
    }
    running.then(release, release)
    return running
  }
}
