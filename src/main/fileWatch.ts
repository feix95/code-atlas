// 「打开的文件被外面动了」哨兵:一张打开的文件签一个监工,盯文件本体。
// 真机实验结论(Node 24/Windows):file 级 fs.watch 扛得住原子替换/删除重建,
// dir 级反而多吃 .tmp 噪音 —— 所以盯文件不盯目录。
// 三不原则:不辨事件型(rename/change 一视同仁)、不重复报(防抖 + 按 mtime 判真变)、
// 不报自家人(saveFile 回执的 mtime 对上就吞)。
// 本模块不含 electron 依赖:自测脚本直接驱动它,不用把 Electron 拖进 node 进程。
import { watch, type FSWatcher } from 'node:fs'
import { promises as fs } from 'node:fs'

export interface FileWatchSignal {
  rootPath: string
  relPath: string
  absPath: string
  /** 最新修改时间(ms);文件已不在磁盘上 = null */
  mtimeMs: number | null
}

interface WatchEntry {
  watcher: FSWatcher
  /** 同一个文件可能被主窗/子窗的签同时开着,按登记计数,归零才收监工 */
  refs: number
  rootPath: string
  relPath: string
  absPath: string
  /** 我们自己写盘留下的 mtime:事件对上就吞掉(自激),只吞一次 */
  ownMtimeMs: number | null
  /** 上次已通报过的 mtime:对上是重复事件,吞掉 */
  lastSeenMs: number | null
  timer: ReturnType<typeof setTimeout> | null
}

/** 文件系统一次动作会连报好几遍(Windows 天性),攒一攒再核 */
const DEBOUNCE_MS = 150

export class FileWatchRegistry {
  private entries = new Map<string, WatchEntry>()
  private emit: (sig: FileWatchSignal) => void
  private debounceMs: number

  constructor(emit: (sig: FileWatchSignal) => void, debounceMs: number = DEBOUNCE_MS) {
    this.emit = emit
    this.debounceMs = debounceMs
  }

  get size(): number {
    return this.entries.size
  }

  /** 挂监工;文件此刻读不到(被删等)则老实回 false,调用方降级不崩 */
  add(rootPath: string, relPath: string, absPath: string): boolean {
    const existing = this.entries.get(absPath)
    if (existing) {
      existing.refs += 1
      return true
    }
    let watcher: FSWatcher
    try {
      watcher = watch(absPath, () => this.schedule(absPath))
    } catch {
      return false
    }
    watcher.on('error', () => {
      // 句柄被打死(盘被拔等):摘掉这条登记,下次 add 再立新监工
      this.drop(absPath)
    })
    this.entries.set(absPath, {
      watcher,
      refs: 1,
      rootPath,
      relPath,
      absPath,
      ownMtimeMs: null,
      lastSeenMs: null,
      timer: null
    })
    return true
  }

  remove(absPath: string): void {
    const entry = this.entries.get(absPath)
    if (!entry) return
    entry.refs -= 1
    if (entry.refs <= 0) this.drop(absPath)
  }

  /** saveFile 写完盘报个到:接下来那次对这个 mtime 的事件是我们自己人,吞 */
  noteOwnWrite(absPath: string, mtimeMs: number): void {
    const entry = this.entries.get(absPath)
    if (entry) entry.ownMtimeMs = mtimeMs
  }

  /**
   * 自家人改名:登记迁去新路径 —— 老监工关闭,新路径上立同等登记的监工。
   * lastSeen 记上改名后的 mtime:换登记头一回事件对上状态表吞掉,不误报「外面动了」;
   * 新路径立不起监工(读不到等)就空着手回来,与 add 回 false 的降级同口径。
   */
  move(oldAbs: string, newAbs: string, newRelPath: string, mtimeMs: number): void {
    const entry = this.entries.get(oldAbs)
    if (!entry) return
    const { refs, rootPath } = entry
    this.drop(oldAbs)
    if (this.add(rootPath, newRelPath, newAbs)) {
      const moved = this.entries.get(newAbs)
      if (moved) {
        moved.refs = refs
        moved.lastSeenMs = mtimeMs
      }
    }
  }

  dispose(): void {
    for (const absPath of [...this.entries.keys()]) this.drop(absPath)
  }

  private drop(absPath: string): void {
    const entry = this.entries.get(absPath)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.watcher.close()
    this.entries.delete(absPath)
  }

  private schedule(absPath: string): void {
    const entry = this.entries.get(absPath)
    if (!entry || entry.timer) return
    entry.timer = setTimeout(() => {
      entry.timer = null
      void this.verify(absPath)
    }, this.debounceMs)
  }

  /** 核账:stat 拿最新 mtime,对上自激/重复就吞,真变了才通报;读不到(被删)按 null 通报 */
  private async verify(absPath: string): Promise<void> {
    const entry = this.entries.get(absPath)
    if (!entry) return
    const stat = await fs.stat(absPath).catch(() => null)
    // stat 悬空期间登记可能已迁/已收(自家人改名等):旧账不再报,免谎报「被删」
    if (this.entries.get(absPath) !== entry) return
    const mtimeMs = stat?.isFile() ? stat.mtimeMs : null
    if (mtimeMs !== null) {
      if (entry.ownMtimeMs === mtimeMs) {
        entry.ownMtimeMs = null // 自激只吞一次
        return
      }
      if (entry.lastSeenMs === mtimeMs) return
      entry.lastSeenMs = mtimeMs
    }
    this.emit({
      rootPath: entry.rootPath,
      relPath: entry.relPath,
      absPath,
      mtimeMs
    })
  }
}
