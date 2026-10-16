import { useEffect, useRef, useState } from 'react'
import type { VisionSupport } from '@shared/types'
import { CHAT_IMAGES_MAX, CHAT_IMAGE_LONG_EDGE, imageGate, type ChatImage } from '@shared/chatImage'
import { sniffImage } from '@shared/imageMeta'
import { IMAGE_PREVIEW_MAX_BYTES } from '@shared/preview'

/**
 * 待发图片的小账本(第一百五十二锤):三个入口(「+」菜单选文件、剪贴板粘贴、
 * 从系统拖文件进来)都汇到 addFiles —— 同一份校验口径:只收 JPG/PNG(魔数验,不认后缀)、
 * 单张不超上限、最多 3 张;收进来的先压长边到 1024 再入账(保持原格式)。
 * 能力闸:纯文本模型一律拒收并垫灰字;能力中途变成纯文本时,待发图片自动清掉并报一声。
 */
export interface ChatImagesApi {
  images: ChatImage[]
  /** 入口置灰依据:text-only 不放行(reason),unknown 放行但带提醒(hint) */
  gate: { allow: boolean; reason?: string; hint?: string }
  addFiles: (files: Iterable<File>) => Promise<void>
  removeImage: (id: string) => void
  clear: () => void
}

function bytesToDataUrl(bytes: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(bytes)
  })
}

/** 文件 → 收编好的 ChatImage(画布缩到长边<=1024);不合格就回一句拒收的人话 */
async function fileToChatImage(file: File): Promise<ChatImage | string> {
  const name = file.name.trim() || '图片'
  const fail = (why: string): string => `「${name}」${why}`
  if (file.size > IMAGE_PREVIEW_MAX_BYTES)
    return fail(`太大(超过 ${Math.floor(IMAGE_PREVIEW_MAX_BYTES / 1024 / 1024)}MB),换张小点的`)
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return fail('读不出来,没带进来')
  }
  const sniff = sniffImage(bytes)
  if (!sniff) return fail('不是有效的 JPG/PNG 图片,只收这两种')
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, CHAT_IMAGE_LONG_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return fail('画布开不起来,没带进来')
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, sniff.mime, 0.9)
    )
    if (!blob) return fail('没转出来,没带进来')
    return {
      id: crypto.randomUUID(),
      name,
      mime: sniff.mime,
      dataUrl: await bytesToDataUrl(blob),
      width,
      height
    }
  } catch {
    return fail('解码不了,没带进来')
  }
}

export function useChatImages(
  vision: VisionSupport,
  /** 垫灰字的口(渲染层的 note):拒收/清账都走它跟人交代 */
  note: (text: string) => void
): ChatImagesApi {
  const [images, setImages] = useState<ChatImage[]>([])
  const visionRef = useRef(vision)
  const noteRef = useRef(note)
  const imagesRef = useRef(images)
  // ref 只能在渲染外更新(React 规矩):账本会话内顺手镜像,addFiles/清账都读 ref 不看旧快照
  useEffect(() => {
    visionRef.current = vision
    noteRef.current = note
    imagesRef.current = images
  })

  // 能力中途掉成纯文本(换了模型/服务):待发图片不能留着骗人 —— 清掉并报一声
  useEffect(() => {
    if (vision === 'text-only' && imagesRef.current.length > 0) {
      setImages([])
      noteRef.current('当前模型是纯文本模型,看不了图片 —— 待发的图片先清掉了')
    }
  }, [vision])

  async function addFiles(files: Iterable<File>): Promise<void> {
    const gateNow = imageGate(visionRef.current, 1)
    if (!gateNow.allow) {
      noteRef.current(gateNow.reason ?? '当前模型看不了图片')
      return
    }
    for (const file of files) {
      if (imagesRef.current.length >= CHAT_IMAGES_MAX) {
        noteRef.current(`一次最多带 ${CHAT_IMAGES_MAX} 张图片,多出的没加进来`)
        break
      }
      const result = await fileToChatImage(file)
      if (typeof result === 'string') {
        noteRef.current(result)
        continue
      }
      imagesRef.current = [...imagesRef.current, result]
      setImages(imagesRef.current)
    }
  }

  function removeImage(id: string): void {
    setImages((prev) => {
      const next = prev.filter((img) => img.id !== id)
      imagesRef.current = next
      return next
    })
  }

  function clear(): void {
    imagesRef.current = []
    setImages([])
  }

  return {
    images,
    gate: imageGate(vision, 1),
    addFiles,
    removeImage,
    clear
  }
}
