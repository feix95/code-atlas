// 人看的数字格式化,主进程渲染层共用,防止口径不一

/**
 * 文件大小的人话版(第九十锤,给文件树右栏用):紧凑、位数稳定。
 * 规矩:字节直报;满 10 才丢小数(3.2 KB、12 KB、1.8 MB、1.2 GB),1024 进位
 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  const gb = mb / 1024
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`
}
