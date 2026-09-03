// 语言识别器自测:npm run test:parser
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  identifyByExtension,
  identifyFromContent,
  identifyFileLanguage
} from '../src/parser/index.ts'
import { scanDirectory } from '../src/scanner/index.ts'

const buf = (s: string): Buffer => Buffer.from(s, 'utf8')

function assertTag(
  actual: { id: string; source: string } | null,
  id: string,
  source: string,
  label: string
): void {
  assert.ok(actual, `${label}: 应能识别出语言`)
  assert.equal(actual.id, id, `${label}: 语言应为 ${id}`)
  assert.equal(actual.source, source, `${label}: 来源应为 ${source}`)
}

async function main(): Promise<void> {
  // ── 一、后缀速查 ──
  assertTag(identifyByExtension('app.ts'), 'typescript', 'extension', 'app.ts')
  assertTag(identifyByExtension('App.tsx'), 'typescript-react', 'extension', 'App.tsx')
  assertTag(identifyByExtension('util.JS'), 'javascript', 'extension', '大写后缀 util.JS')
  assertTag(identifyByExtension('main.go'), 'go', 'extension', 'main.go')
  assertTag(identifyByExtension('Main.java'), 'java', 'extension', 'Main.java')
  assertTag(identifyByExtension('Program.cs'), 'csharp', 'extension', 'Program.cs')
  assertTag(identifyByExtension('main.cpp'), 'cpp', 'extension', 'main.cpp')
  assertTag(identifyByExtension('lib.rs'), 'rust', 'extension', 'lib.rs')
  assertTag(identifyByExtension('cli.py'), 'python', 'extension', 'cli.py')
  assertTag(identifyByExtension('data.json'), 'json', 'extension', 'data.json')
  assertTag(identifyByExtension('Makefile'), 'makefile', 'extension', 'Makefile')
  assertTag(identifyByExtension('Dockerfile'), 'dockerfile', 'extension', 'Dockerfile')
  assertTag(identifyByExtension('.gitignore'), 'gitignore', 'extension', '.gitignore')
  assert.equal(identifyByExtension('photo.xyz'), null, '陌生后缀应交给内容嗅探')
  assert.equal(identifyByExtension('noext'), null, '无后缀应交给内容嗅探')

  // ── 二、内容嗅探 ──
  assertTag(
    identifyFromContent('run', buf('#!/usr/bin/env python3\nimport os\nprint("hi")\n')),
    'python',
    'content',
    'shebang python'
  )
  assertTag(
    identifyFromContent('install', buf('#!/bin/bash\nif [ -f x ]; then\n  echo $x\nfi\n')),
    'shell',
    'content',
    'shebang bash'
  )
  assertTag(
    identifyFromContent('mystery', buf('interface User {\n  id: number;\n}\nconst name: string = "a";\n')),
    'typescript',
    'content',
    'TS 语法特征'
  )
  assertTag(
    identifyFromContent('mystery', buf('function hello() {\n  console.log("hi");\n}\n')),
    'javascript',
    'content',
    'JS 语法特征(不许冒充 TS)'
  )
  assertTag(
    identifyFromContent('main', buf('package main\n\nfunc main() {\n  fmt.Println("hi")\n}\n')),
    'go',
    'content',
    'Go 语法特征'
  )
  assertTag(
    identifyFromContent('m3', buf('fn main() {\n  println!("hi");\n}\n')),
    'rust',
    'content',
    'Rust 语法特征'
  )
  assertTag(
    identifyFromContent('m4', buf('#include <iostream>\nint main() {\n  std::cout << "hi";\n}\n')),
    'cpp',
    'content',
    'C++ 语法特征'
  )
  assertTag(
    identifyFromContent('m5', buf('#include <stdio.h>\nint main() {\n  printf("hi");\n  return 0;\n}\n')),
    'c',
    'content',
    'C 语法特征(不许冒充 C++)'
  )
  assertTag(identifyFromContent('m6', buf('<?php\necho 1;\n')), 'php', 'content', 'PHP 标记')
  assertTag(identifyFromContent('cfg', buf('name: my-app\nversion: 1\n')), 'yaml', 'content', 'YAML 结构')
  assert.equal(identifyFromContent('blob', buf('a\x00b')), null, '二进制应拒绝猜')
  assert.equal(identifyFromContent('empty', buf('')), null, '空文件应拒绝猜')

  // ── 三、完整识别(临时文件走真 I/O)──
  const dir = join(tmpdir(), `code-atlas-parser-test-${Date.now()}`)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'run'), '#!/usr/bin/env python3\nimport os\n')
  await fs.writeFile(join(dir, 'app.ts'), 'export {}')
  await fs.writeFile(join(dir, 'unknown.xyz'), 'hello world blah')
  await fs.writeFile(join(dir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02]))

  try {
    assertTag(await identifyFileLanguage(join(dir, 'run'), 'run'), 'python', 'content', '无后缀 shebang 文件')
    assertTag(await identifyFileLanguage(join(dir, 'app.ts'), 'app.ts'), 'typescript', 'extension', '有后缀文件')
    assertTag(
      await identifyFileLanguage(join(dir, 'unknown.xyz'), 'unknown.xyz'),
      'text',
      'content',
      '认不出的纯文本兜底'
    )
    assert.equal(await identifyFileLanguage(join(dir, 'blob.bin'), 'blob.bin'), null, '二进制无语言')

    // ── 三·五、大文件防线:只读文件头,绝不整只读进内存 ──
    // 稀疏文件:先写满一段文本(头 4KB 不能有零字节),再 truncate 撑大,瞬间造出"巨型文件"
    const smallHead = 'interface User {\n  id: number;\n}\nconst name: string = "a";\n'.padEnd(4096, ' ')
    await fs.writeFile(join(dir, 'huge.xyz'), smallHead)
    await fs.truncate(join(dir, 'huge.xyz'), 6 * 1024 * 1024) // 6MB,超过 5MB 嗅探红线
    assert.equal(
      await identifyFileLanguage(join(dir, 'huge.xyz'), 'huge.xyz'),
      null,
      '超大文件不嗅探,诚实认不出'
    )

    await fs.writeFile(join(dir, 'medium.xyz'), smallHead)
    await fs.truncate(join(dir, 'medium.xyz'), 3 * 1024 * 1024) // 3MB,红线以内照常嗅探
    assertTag(
      await identifyFileLanguage(join(dir, 'medium.xyz'), 'medium.xyz'),
      'typescript',
      'content',
      '红线以内的大文件只读开头照样认出'
    )

    await fs.writeFile(join(dir, 'movie.mp4'), '看起来像文本的视频壳')
    assert.equal(
      await identifyFileLanguage(join(dir, 'movie.mp4'), 'movie.mp4'),
      null,
      '视频壳走二进制黑名单,零 I/O 直接放过'
    )

    // ── 四、扫描器联动:byLanguage 统计与树节点标签 ──
    await fs.writeFile(join(dir, 'lib.rs'), 'fn main() { println!("x"); }\n')
    await fs.writeFile(join(dir, 'data.json'), '{}')
    await fs.writeFile(join(dir, 'notes.md'), '# Notes\n')
    const scan = await scanDirectory(dir)

    assert.equal(scan.stats.byLanguage['typescript']?.count, 2, 'TypeScript 应 2 个(app.ts + medium.xyz 嗅探认出)')
    assert.equal(scan.stats.byLanguage['rust']?.count, 1, 'Rust 应 1 个')
    assert.equal(scan.stats.byLanguage['python']?.count, 1, 'Python 应 1 个(嗅探认出)')
    assert.equal(scan.stats.byLanguage['text']?.count, 1, '纯文本兜底只算 unknown.xyz 一个,二进制不计入')

    const fileTag = (name: string) => scan.tree.children.find((c) => c.name === name)
    assert.equal(fileTag('app.ts')?.language?.source, 'extension')
    assert.equal(fileTag('run')?.language?.source, 'content', '树节点应保留嗅探来源')
    assert.equal(fileTag('blob.bin')?.language, undefined, '二进制节点无语言标签')

    console.log('✅ 语言识别器自测全部通过')
    console.log(
      `   语言 ${Object.keys(scan.stats.byLanguage).length} 种 · 文件 ${scan.stats.fileCount} 个 · 耗时 ${scan.durationMs}ms`
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
