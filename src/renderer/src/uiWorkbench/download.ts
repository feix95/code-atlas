// 文本导出落地:Blob + a[download] 触发 Electron 默认的另存对话框,主进程零改动。

export function downloadText(
  fileName: string,
  text: string,
  mimeType: string,
  doc: Document
): void {
  const anchor = doc.createElement('a')
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  anchor.href = url
  anchor.download = fileName
  doc.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
