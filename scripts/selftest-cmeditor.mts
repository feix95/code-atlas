import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EditorState } from '@codemirror/state'
import { highlightField, selectionToRef, setHighlight } from '../src/renderer/src/editor/cmSetup.ts'

/** 收集装饰集里的所有标记:[from, to, class] */
function marks(state: EditorState): [number, number, string][] {
  const out: [number, number, string][] = []
  state.field(highlightField).between(0, state.doc.length, (from, to, value) => {
    out.push([from, to, value.spec.class as string])
  })
  return out
}

function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [highlightField] })
}

function main(): void {
  // 一、分色账翻译:行内段落账 → CM 装饰标记
  // doc:'const x = "s";\nfoo bar\n'  行 0:'const x = "s";' 行 1:'foo bar'
  let state = makeState('const x = "s";\nfoo bar\n')
  // HL_KINDS: 0=ctl 1=kw 2=str 3=com 4=num 5=fn 6=type 7=var 8=regex 9=symbol
  state = state.update({
    effects: setHighlight.of([
      [
        [0, 5, 1],
        [10, 13, 2]
      ],
      [[0, 3, 5]]
    ])
  }).state
  assert.deepEqual(
    marks(state),
    [
      [0, 5, 'tok-kw'],
      [10, 13, 'tok-str'],
      [15, 18, 'tok-fn']
    ],
    '行内段应译成带 tok-* 类名的区间标记(第二行起点 = 15)'
  )

  // 二、doc 变了装饰自动挪位:最前头插 3 个字符,所有标记后移 3
  state = state.update({ changes: { from: 0, insert: '// ' } }).state
  assert.deepEqual(
    marks(state),
    [
      [3, 8, 'tok-kw'],
      [13, 16, 'tok-str'],
      [18, 21, 'tok-fn']
    ],
    '插入字符后旧装饰应跟着挪位(打字不掉色的保证)'
  )

  // 三、剪烂账:越界/不认得的角色/空段,一律不画
  state = makeState('ab\n')
  state = state.update({
    effects: setHighlight.of([
      [
        [0, 99, 1],
        [1, 2, 77],
        [2, 2, 0]
      ]
    ])
  }).state
  assert.deepEqual(marks(state), [[0, 2, 'tok-kw']], '越界段应剪到行长,烂角色/空段不画')

  // 四、清空账:undefined = 这份不上色
  state = state.update({ effects: setHighlight.of(undefined) }).state
  assert.equal(marks(state).length, 0, 'undefined 账应清成空装饰')

  // 五、选区折算:位置 → 引用行号
  const doc = makeState('a\nb\nc\n').doc
  assert.deepEqual(selectionToRef(doc, 0, 4), { startLine: 1, endLine: 2, code: 'a\nb\n' })
  assert.deepEqual(selectionToRef(doc, 0, 2), { startLine: 1, endLine: 1, code: 'a\n' })
  // 收尾压第 3 行行首(选 'a\nb\n' + 第3行0列):第 3 行一个字没选中,不算进来
  assert.deepEqual(selectionToRef(doc, 0, 4), { startLine: 1, endLine: 2, code: 'a\nb\n' })
  // 反向选(from>to 由调用方归一,这里只认区间)与行中选
  assert.deepEqual(selectionToRef(doc, 2, 3), { startLine: 2, endLine: 2, code: 'b' })
  // 空选/纯空白回 null
  assert.equal(selectionToRef(doc, 1, 1), null, '光标不该有引用')
  assert.equal(selectionToRef(doc, 1, 2), null, '只选中换行不该有引用')

  // 六、暗色插入符:CM 自绘光标默认黑边,没挂 darkTheme 时暗底会看不见。
  // 原生 caret-color 被 hideNativeSelection 的 transparent !important 掐掉,
  // 真正露脸的是 .cm-cursor 的左边框,必须跟 --text;格内 contenteditable
  // 聚焦时 CM 又把 caret-color 打回 initial,也要抢回来。
  const editorCss = readFileSync(
    join(process.cwd(), 'src/renderer/src/assets/css/workspace-editor.css'),
    'utf8'
  )
  assert.match(
    editorCss,
    /\.cm-cursor,\s*\.cm-host \.cm-dropCursor \{\s*border-left-color:\s*var\(--text\);/,
    'CM 自绘光标必须跟 --text,暗色底不能再用库默认黑边'
  )
  assert.match(
    editorCss,
    /\.cm-content :focus \{\s*caret-color:\s*var\(--text\)\s*!important;/,
    '格内 contenteditable 聚焦时须抢回 caret-color,压过 CM 的 initial'
  )
  const tokensCss = readFileSync(
    join(process.cwd(), 'src/renderer/src/assets/css/tokens.css'),
    'utf8'
  )
  assert.match(
    tokensCss,
    /html,\s*body \{[^}]*caret-color:\s*var\(--text\);/,
    '原生插入符(输入框/标题改名)也要跟 --text,别靠系统默认黑条'
  )

  console.log('✅ CodeMirror 装配自测全部通过')
  console.log('   分色账翻译 · 装饰挪位 · 烂账剪除 · 清账 · 选区行号口径 · 暗色插入符')
}

main()
