// 聊天文件链接检测器的自测:阶梯规矩(带路径直认/唯一文件名才认/裸词不认)、
// 行号剥离、标点收尾、大小写斜杠跑偏,一条条过 —— 检测器画错一个,界面上就多一个死链接。
// 纯函数,不碰任何系统东西。
import assert from 'node:assert/strict'
import { buildFileLinkIndex, findFileLinks } from '../src/shared/fileLinks.ts'

function main(): void {
  const paths = [
    'src/ai/index.ts',
    'src/main/index.ts',
    'src/main/agent.ts',
    'package.json',
    'docs/a/README.md',
    'docs/b/README.md',
    'Makefile'
  ]
  const index = buildFileLinkIndex(paths)

  // ── 1. 建索引:重名的名字不进按名索引,唯一的进 ──
  assert.equal(index.byPath.size, 7, '七条路径全进按路径索引')
  assert.ok(!index.byName.has('readme.md'), '两个 README.md 重名,按名索引不收')
  assert.ok(index.byName.has('package.json'), '唯一的 package.json 进按名索引')
  assert.ok(!index.byName.has('makefile'), '没后缀的 Makefile 不进按名索引(裸词一律不认)')

  // ── 2. 带路径的直接认,行号剥出来 ──
  const hits = findFileLinks('重点在 src/ai/index.ts:291 附近', index)
  assert.equal(hits.length, 1, '认出一处')
  assert.equal(hits[0].relPath, 'src/ai/index.ts', '规范写法')
  assert.equal(hits[0].line, 291, '行号剥出来')
  assert.equal(hits[0].start, 4, '起点落在路径第一个字符')
  assert.equal(hits[0].end, 23, '终点盖住行号')

  // ── 3. 不带行号的纯路径也认 ──
  const noLine = findFileLinks('改一下 src/main/agent.ts 就行', index)
  assert.equal(noLine.length, 1)
  assert.equal(noLine[0].line, undefined, '没写行号就是没行号')

  // ── 4. 唯一的文件名裸写也认(带后缀)──
  const bare = findFileLinks('看看 package.json 里写了啥', index)
  assert.equal(bare.length, 1)
  assert.equal(bare[0].relPath, 'package.json')

  // ── 5. 重名的裸写不认:点了不知道开哪个,宁可不变链接 ──
  const dup = findFileLinks('README.md 和另一个 README.md', index)
  assert.equal(dup.length, 0, '重名文件名不画链接')  // ── 6. 没后缀的词:对上根目录真实文件才认(那本身就是完整路径),普通词不认 ──
  assert.equal(findFileLinks('看看 Makefile 咋写的', index).length, 1, '根目录 Makefile 精确对上,认')
  assert.equal(findFileLinks('先跑 main 再说', index).length, 0, '普通裸词不认')

  // ── 7. 模型编的路径对不上户口:普通文字,绝不给死链接 ──
  assert.equal(findFileLinks('去 src/ghost/file.ts:1 看', index).length, 0, '不存在的路径不认')

  // ── 8. 大小写和反斜杠跑偏照样认,规范写法还给回来 ──
  const sloppy = findFileLinks('在 SRC\\AI\\INDEX.TS:12 处', index)
  assert.equal(sloppy.length, 1, '大小写反斜杠跑偏也认')
  assert.equal(sloppy[0].relPath, 'src/ai/index.ts', '回的是树里的规范写法')

  // ── 9. 句子标点不吃进链接 ──
  const punct = findFileLinks('见 src/ai/index.ts:3。以及 package.json,还有 (src/main/agent.ts)。', index)
  assert.equal(punct.length, 3, '三种标点收尾各认一处')
  assert.equal(punct[0].end, 19, '行号后的句号不吃进来')
  assert.ok('见 src/ai/index.ts:3。'[19] === '。', '第 19 号格子还是句号')

  // 尾点是路径一部分时摘标点不算错:src/ai/index.ts. 的尾巴句点不算路径
  const trail = findFileLinks('见 src/ai/index.ts.', index)
  assert.equal(trail.length, 1)
  assert.equal(trail[0].end, 17, '尾巴句点留在句子里,不吃进链接')

  // ── 10. 「路径:行号:列号」只剥行号,列号跟着进 span ──
  const col = findFileLinks('报错在 src/ai/index.ts:291:15', index)
  assert.equal(col.length, 1)
  assert.equal(col[0].line, 291, '列号不冒充行号')
  assert.equal(col[0].end, 26, 'span 盖到列号尾巴')

  // ── 11. 中文冒号也认 ──
  const cn = findFileLinks('位于 src/ai/index.ts：50', index)
  assert.equal(cn.length, 1)
  assert.equal(cn[0].line, 50, '中文冒号剥行号')

  // ── 12. 中文和路径贴着写(没空格)也切得开 ──
  const cn2 = findFileLinks('答案在src/ai/index.ts:12里', index)
  assert.equal(cn2.length, 1)
  assert.equal(cn2[0].start, 3, '中文后贴着的路径照认')

  // ── 13. 网址不冒领:https:// 里的路径样子货不认 ──
  assert.equal(findFileLinks('文档在 https://example.com/src/ai/index.ts:1 看不到', index).length, 0, '网址里的路径不认')

  // ── 14. 时间数字不冒领 ──
  assert.equal(findFileLinks('等了 12:30 才回复', index).length, 0, '12:30 不是文件')
  assert.equal(findFileLinks('版本 v1.2.3 上线了', index).length, 0, '版本号不是文件')

  // ── 15. 空输入和空索引不出事 ──
  assert.equal(findFileLinks('', index).length, 0)
  assert.equal(findFileLinks('src/ai/index.ts:1', buildFileLinkIndex([])).length, 0)

  console.log('fileLinks 自测全绿')
}

main()
