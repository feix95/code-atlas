// 自测用的 .docx 样本工厂:在内存里拼一个「只存不压」的 zip,仓库里不放任何二进制样本。
// 只造 mammoth 读得懂的最小部件:内容类型表、关系表、样式表、正文,外加可选的图片。
import { crc32 } from 'node:zlib'

export interface ZipEntry {
  name: string
  data: Uint8Array
  /** 故意在中央目录里虚报解压后大小(造「解压炸弹」样本用) */
  declaredSize?: number
}

/** 拼一个只存不压的 zip(method 0) */
export function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const size = entry.data.byteLength
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(size, 20)
    central.writeUInt32LE(entry.declaredSize ?? size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, Buffer.from(entry.data))
    centrals.push(central, name)
    offset += local.length + name.length + size
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

/** 1x1 透明 PNG */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${REL_TYPE}/officeDocument" Target="word/document.xml"/>
</Relationships>`

/** 段落样式登记:styleId 是正文引用的编号,name 是 styles.xml 里存的名字 */
export interface DocxStyle {
  id: string
  name: string
}

/** 英文版 Word 的内置标题样式:编号 Heading1,存名 heading 1 */
const DEFAULT_STYLES: DocxStyle[] = [
  { id: 'Heading1', name: 'heading 1' },
  { id: 'Heading2', name: 'heading 2' }
]

function stylesXml(styles: DocxStyle[]): string {
  const rows = styles
    .map(
      (s) => `<w:style w:type="paragraph" w:styleId="${s.id}"><w:name w:val="${s.name}"/></w:style>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">${rows}</w:styles>`
}

/** 正文 XML 片段的小工具:一段话 / 一级标题 / 一个超链接段 */
export const docxXml = {
  para: (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`,
  heading: (text: string, styleId = 'Heading1'): string =>
    `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`,
  link: (relId: string, text: string): string =>
    `<w:p><w:hyperlink r:id="${relId}"><w:r><w:t>${text}</w:t></w:r></w:hyperlink></w:p>`,
  table: (rows: string[][]): string =>
    `<w:tbl>${rows
      .map(
        (row) =>
          `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t>${cell}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`
      )
      .join('')}</w:tbl>`,
  image: (relId: string): string =>
    `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="pic" descr="sample picture"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${relId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

export interface DocxSpec {
  /** 正文里的段落 XML(用 docxXml 拼) */
  body: string[]
  /** 外链关系:rId → 地址(超链接用) */
  links?: Record<string, string>
  /** 内嵌图片关系:rId → 文件名(放进 word/media/,内容默认是 TINY_PNG) */
  images?: Record<string, string>
  /** 按文件名指定图片字节(大文档样本用);没指定的仍是 TINY_PNG */
  imageData?: Record<string, Uint8Array>
  /** 段落样式表;缺省 = 英文版 Word 的 heading 1 / heading 2 */
  styles?: DocxStyle[]
}

const enc = (text: string): Uint8Array => Buffer.from(text, 'utf8')

/** 按规格拼一份 mammoth 读得懂的 .docx 字节 */
export function buildDocx(spec: DocxSpec): Buffer {
  const rels = [
    ...Object.entries(spec.links ?? {}).map(
      ([id, url]) =>
        `<Relationship Id="${id}" Type="${REL_TYPE}/hyperlink" Target="${url}" TargetMode="External"/>`
    ),
    ...Object.entries(spec.images ?? {}).map(
      ([id, file]) => `<Relationship Id="${id}" Type="${REL_TYPE}/image" Target="media/${file}"/>`
    )
  ].join('')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${spec.body.join('')}</w:body></w:document>`
  return buildZip([
    { name: '[Content_Types].xml', data: enc(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc(ROOT_RELS) },
    { name: 'word/document.xml', data: enc(document) },
    { name: 'word/styles.xml', data: enc(stylesXml(spec.styles ?? DEFAULT_STYLES)) },
    {
      name: 'word/_rels/document.xml.rels',
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
      )
    },
    ...Object.values(spec.images ?? {}).map((file) => ({
      name: `word/media/${file}`,
      data: spec.imageData?.[file] ?? TINY_PNG
    }))
  ])
}

/** 自测共用的样本:标题 + 段落 + 表格 + 内嵌图片 + 一条 javascript: 恶意链接 + 一条正常外链 */
export function buildSampleDocx(): Buffer {
  return buildDocx({
    body: [
      docxXml.heading('Quarterly plan'),
      docxXml.para('Hello from Word'),
      docxXml.table([
        ['Name', 'Role'],
        ['Kui', 'Illustrator']
      ]),
      docxXml.image('rIdImg'),
      docxXml.link('rIdEvil', 'evil link'),
      docxXml.link('rIdOk', 'good link')
    ],
    links: { rIdEvil: 'javascript:alert(1)', rIdOk: 'https://example.com/' },
    images: { rIdImg: 'image1.png' }
  })
}
