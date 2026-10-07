// 文件系统相关的「说人话」小工具:权限/占用报错文案 + 字节数格式化。
// 独立放 shared 的原因:aiEvidence.ts 里有 electron 依赖(net.fetch),纯 node 的自测够不着;
// 这两个函数本身是纯函数,搬出来让 fileEdit 这类不碰 Electron 的模块也能用同一份口径。

/**
 * 文件夹/文件打不开时说人话:被 Windows 上锁的(EPERM/EACCES,常见于系统保护区)
 * 和真不存在的,必须分成两种说法 —— 谎报"不存在"会让用户以为自己删了什么东西
 */
export function accessDeniedMessage(
  err: NodeJS.ErrnoException,
  kind: '文件夹' | '文件',
  relPath: string
): string {
  if (err?.code === 'EPERM' || err?.code === 'EACCES') {
    return `「${relPath}」被 Windows 上了锁,软件没钥匙看不了 —— 这类多半是系统自管的内部文件夹,不是你的项目内容,不看也不影响`
  }
  // Windows 核心文件(如 swapfile.sys)连 stat 都不给(EINVAL),独占占用是 EBUSY —— 不是"不存在",别谎报
  if (err?.code === 'EINVAL' || err?.code === 'EBUSY') {
    return `「${relPath}」被 Windows 独占占用(多半是系统自己管的核心文件),软件读不了 —— 不是你删了什么,不看也不影响`
  }
  return `${kind}不存在:${relPath}`
}

/** 字节数 → 人话大小(提示词里给模型的证据) */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
