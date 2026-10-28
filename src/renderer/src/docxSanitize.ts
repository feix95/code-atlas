// Word 预览上屏前的消毒工序:主进程 mammoth 转出的网页来自外部文档,可能夹带脚本、
// 事件属性、会执行代码的链接。这里先用 DOMPurify 按白名单清洗,再做两件事:
// 链接与图片按本文件的规矩二次把关,标签挂上阅读档的排版类名(.md-h / .md-table)。
// 图片只认本次转换登记过的 atlas-media://docx-image/<令牌>,其余地址(外链、file:、data:)一律拆掉。
import DOMPurify from 'dompurify'
import { isDocxImageSrc } from '../../shared/docxMedia.ts'

/** 只收排版用得上的标签:没有 script/style/iframe/form/svg/object 这一族 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'img',
  'blockquote',
  'pre',
  'code',
  'span',
  'div',
  'hr'
]
/**
 * 属性只留结构必需的;style/class/on* 一律不进(样式统一吃阅读档的 design tokens)。
 * 图片的 width/height 是后台线程按字节量出来的像素尺寸,懒加载前先占好位,滚动条不跳。
 */
const ALLOWED_ATTR = ['href', 'src', 'alt', 'id', 'colspan', 'rowspan', 'width', 'height']
/** DOMPurify 的地址白名单:文内锚点、http(s)/mailto、本应用的 Word 图片令牌;别的协议整条属性丢掉 */
const ALLOWED_URI = /^(?:#|https?:|mailto:|atlas-media:\/\/docx-image\/[0-9a-f]{32}$)/i
const PIXEL_SIZE = /^\d{1,5}$/
const EXTERNAL_LINK = /^(?:https?:|mailto:)/i
const MISSING_IMAGE_ALT = '[图片格式不支持预览]'

export type DocxLinkAction =
  { kind: 'anchor'; id: string } | { kind: 'external'; url: string } | { kind: 'none' }

/** 链接点下去该干什么(纯函数):文内锚点就地滚动,http(s)/mailto 交系统浏览器,其余一律不动 */
export function docxLinkAction(href: string | null): DocxLinkAction {
  const target = (href ?? '').trim()
  if (target.startsWith('#') && target.length > 1) return { kind: 'anchor', id: target.slice(1) }
  if (EXTERNAL_LINK.test(target)) return { kind: 'external', url: target }
  return { kind: 'none' }
}

/** 图片地址是不是本次转换登记的令牌地址(纯函数):外链、file:、data:、svg 一概不算 */
export function isInlineImageSrc(src: string | null): boolean {
  return isDocxImageSrc(src)
}

/** 放行的图片:懒加载(滚到附近才向主进程要字节)+ 异步解码;尺寸不是纯像素数就拿掉 */
function finishImage(img: Element): void {
  img.setAttribute('loading', 'lazy')
  img.setAttribute('decoding', 'async')
  for (const name of ['width', 'height']) {
    const value = img.getAttribute(name)
    if (value !== null && !PIXEL_SIZE.test(value)) img.removeAttribute(name)
  }
}

function wrapTable(table: Element): void {
  table.classList.add('md-table')
  const wrap = table.ownerDocument.createElement('div')
  wrap.className = 'md-table-wrap'
  table.replaceWith(wrap)
  wrap.append(table)
}

/** 消毒之后的收尾(只动 DOM,可单测):链接/图片二次把关 + 挂阅读档类名 */
export function finishDocxDom(root: Element): void {
  for (const link of root.querySelectorAll('a')) {
    if (docxLinkAction(link.getAttribute('href')).kind === 'none') link.removeAttribute('href')
    else link.classList.add('md-link')
  }
  for (const img of root.querySelectorAll('img')) {
    if (isInlineImageSrc(img.getAttribute('src'))) {
      finishImage(img)
      continue
    }
    img.removeAttribute('src')
    img.removeAttribute('width')
    img.removeAttribute('height')
    img.setAttribute('alt', MISSING_IMAGE_ALT)
  }
  for (const heading of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    heading.classList.add('md-h', `md-${heading.tagName.toLowerCase()}`)
  }
  for (const table of root.querySelectorAll('table')) wrapTable(table)
}

/**
 * 整套消毒:回可直接上屏的网页;DOMPurify 在当前环境跑不起来时回 null ——
 * 宁可不显示,也不把没洗过的外来网页塞进界面。
 */
export function sanitizeDocxHtml(html: string, doc: Document = document): string | null {
  if (!DOMPurify.isSupported) return null
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true
  })
  const box = doc.createElement('div')
  box.append(fragment)
  finishDocxDom(box)
  return box.innerHTML
}
