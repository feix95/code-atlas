// 主进程二次缩图:渲染层先把长边压到 1024,预算规划还要求更小时,
// 主进程用 Electron nativeImage 再缩一档 —— 只缩不放大,保持 PNG/JPEG 原格式。
// 薄封装一层:解码失败照原样退回(已经过 sanitize 魔数校验,理论上走不到)。
import { nativeImage } from 'electron'
import type { ChatImage } from '../shared/chatImage.ts'

/** 把图片缩到目标尺寸;目标不比原图小就不动 */
export function shrinkChatImage(image: ChatImage, width: number, height: number): ChatImage {
  if (width >= image.width && height >= image.height) return image
  const src = nativeImage.createFromDataURL(image.dataUrl)
  if (src.isEmpty()) return image
  const resized = src.resize({ width, height, quality: 'good' })
  const buffer = image.mime === 'image/png' ? resized.toPNG() : resized.toJPEG(90)
  return {
    ...image,
    width,
    height,
    dataUrl: `data:${image.mime};base64,${buffer.toString('base64')}`
  }
}
