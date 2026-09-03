// AST 分析器自测:npm run test:analyzer(首次加载语法 wasm 约需几秒)
import assert from 'node:assert/strict'
import { analyzeSource, isAnalysisSupported } from '../src/analyzer/index.ts'

const TS_SOURCE = `
import { useState } from 'react'
import path from "node:path"
const fs = require('fs')

export interface Timer {
  seconds: number
}

export type Mode = 'focus' | 'break'

export const startTimer = (): void => {
  console.log('start')
}

const pauseTimer = (): void => {
  console.log('pause')
}

export class TimerStore {
  tick(): void {}
  reset(): void {}
}

function helper(): void {}
export default helper
`

const TSX_SOURCE = `
import { useState } from 'react'

export const TimerPanel = (): JSX.Element => {
  const [seconds] = useState(0)
  return <div className="timer">{seconds}</div>
}

function SmallButton() {
  return <button>ok</button>
}

const notAComponent = (): number => 42
`

const PY_SOURCE = `
import os
from pathlib import Path

class Timer:
    def start(self):
        pass

def pause_timer():
    pass

def _internal():
    pass
`

const JAVA_SOURCE = `
package com.example.app;

import java.util.List;
import java.io.File;

public class UserService {
  private int count;
  public UserService() {
    count = 0;
  }
  public String getName(int id) {
    return "x";
  }
}

public interface Repo {
  String find(int id);
}

enum Color {
  RED, GREEN
}
`

const GO_SOURCE = `
package main

import "fmt"

import (
  "os"
  str "strings"
)

type User struct {
  Name string
}

type Repo interface {
  Find(id int) (*User, error)
}

func NewUser(name string) *User {
  return &User{Name: name}
}

func (u *User) Rename(n string) {
  u.Name = n
}
`

const C_SOURCE = `
#include <stdio.h>
#include "utils.h"

struct Point {
  int x;
  int y;
};

int add(int a, int b) {
  return a + b;
}

void print_point(struct Point p) {
  printf("%d", p.x);
}
`

const CPP_SOURCE = `
#include <vector>
#include "player.h"

class Player {
public:
  void run();
private:
  int speed;
};

struct Config {
  bool debug;
};

void Player::run() {
  speed = 1;
}

int main() {
  return 0;
}
`

const CS_SOURCE = `
using System;
using System.Collections.Generic;

namespace App
{
  public class UserService
  {
    public UserService()
    {
    }

    public string GetName(int id)
    {
      return "x";
    }
  }

  public interface IRepo
  {
    string Find(int id);
  }
}
`

const RUST_SOURCE = `
use std::collections::HashMap;
use crate::config::Config;

pub struct User {
  pub name: String,
}

pub trait Repo {
  fn find(&self, id: u32) -> Option<User>;
}

impl Repo for User {
  fn find(&self, id: u32) -> Option<User> {
    None
  }
}

pub fn build(name: &str) -> User {
  User { name: name.to_string() }
}
`

function assertContains(list: string[], expected: string[], label: string): void {
  for (const item of expected) {
    assert.ok(list.includes(item), `${label}: 应包含 ${item},实际 [${list.join(', ')}]`)
  }
}

async function main(): Promise<void> {
  // ── 一、TypeScript ──
  const ts = await analyzeSource(TS_SOURCE, 'typescript')
  assert.ok(ts, 'TypeScript 应可分析')
  assertContains(ts!.imports, ['react', 'node:path', 'fs'], 'TS imports')
  assertContains(ts!.functions, ['startTimer', 'pauseTimer', 'helper'], 'TS functions')
  assertContains(ts!.classes, ['TimerStore'], 'TS classes')
  assertContains(ts!.interfaces, ['Timer', 'Mode'], 'TS interface + type 别名')
  assertContains(ts!.exports, ['startTimer', 'TimerStore', 'helper'], 'TS exports')
  assert.ok(ts!.reactComponents.length === 0, '纯 TS 无 React 组件')

  // ── 二、TypeScript React:组件识别 ──
  const tsx = await analyzeSource(TSX_SOURCE, 'typescript-react')
  assert.ok(tsx, 'TSX 应可分析')
  assertContains(tsx!.reactComponents, ['TimerPanel', 'SmallButton'], 'TSX 组件(大写开头 + 文件含 JSX)')
  assert.ok(!tsx!.reactComponents.includes('notAComponent'), '小写箭头函数不算组件')
  assertContains(tsx!.imports, ['react'], 'TSX imports')

  // ── 三、Python ──
  const py = await analyzeSource(PY_SOURCE, 'python')
  assert.ok(py, 'Python 应可分析')
  assertContains(py!.imports, ['os', 'pathlib'], 'Py imports')
  assertContains(py!.functions, ['start', 'pause_timer', '_internal'], 'Py functions(含方法)')
  assertContains(py!.classes, ['Timer'], 'Py classes')

  // ── 四、Java ──
  const java = await analyzeSource(JAVA_SOURCE, 'java')
  assert.ok(java, 'Java 应可分析')
  assertContains(java!.imports, ['java.util.List', 'java.io.File'], 'Java imports')
  assertContains(java!.functions, ['getName', 'UserService'], 'Java functions(含构造器)')
  assertContains(java!.classes, ['UserService', 'Color'], 'Java classes(含枚举)')
  assertContains(java!.interfaces, ['Repo'], 'Java interfaces')

  // ── 五、Go ──
  const go = await analyzeSource(GO_SOURCE, 'go')
  assert.ok(go, 'Go 应可分析')
  assertContains(go!.imports, ['fmt', 'os', 'strings'], 'Go imports(带别名的取真实路径)')
  assertContains(go!.functions, ['NewUser', 'Rename'], 'Go functions(含方法)')
  assertContains(go!.classes, ['User'], 'Go struct 归类')
  assertContains(go!.interfaces, ['Repo'], 'Go interface 归接口')

  // ── 六、C ──
  const c = await analyzeSource(C_SOURCE, 'c')
  assert.ok(c, 'C 应可分析')
  assertContains(c!.imports, ['stdio.h', 'utils.h'], 'C #include')
  assertContains(c!.functions, ['add', 'print_point'], 'C functions')
  assertContains(c!.classes, ['Point'], 'C struct 归类')

  // ── 七、C++ ──
  const cpp = await analyzeSource(CPP_SOURCE, 'cpp')
  assert.ok(cpp, 'C++ 应可分析')
  assertContains(cpp!.imports, ['vector', 'player.h'], 'C++ #include')
  assertContains(cpp!.functions, ['run', 'main'], 'C++ functions(含类外定义 Player::run)')
  assertContains(cpp!.classes, ['Player', 'Config'], 'C++ class + struct')

  // ── 八、C# ──
  const cs = await analyzeSource(CS_SOURCE, 'csharp')
  assert.ok(cs, 'C# 应可分析')
  assertContains(cs!.imports, ['System', 'System.Collections.Generic'], 'C# using')
  assertContains(cs!.functions, ['GetName', 'UserService'], 'C# functions(含构造器)')
  assertContains(cs!.classes, ['UserService'], 'C# classes')
  assertContains(cs!.interfaces, ['IRepo'], 'C# interfaces')

  // ── 九、Rust ──
  const rust = await analyzeSource(RUST_SOURCE, 'rust')
  assert.ok(rust, 'Rust 应可分析')
  assertContains(rust!.imports, ['std::collections::HashMap', 'crate::config::Config'], 'Rust use')
  assertContains(rust!.functions, ['build', 'find'], 'Rust functions(含 trait 内签名)')
  assertContains(rust!.classes, ['User'], 'Rust struct 归类')
  assertContains(rust!.interfaces, ['Repo'], 'Rust trait 归接口')

  // ── 十、能力边界:没接入的语言诚实返回 null ──
  assert.equal(isAnalysisSupported('vue'), false, 'Vue 暂不支持')
  assert.equal(await analyzeSource('anything', 'vue'), null, '不支持的语言返回 null')
  assert.equal(await analyzeSource('anything', 'unknown'), null, '未知语言返回 null')

  // ── 十一、坏代码不崩:解析器带 ERROR 节点也能提取出能提的 ──
  const broken = await analyzeSource('function broken( { const x = ', 'typescript')
  assert.ok(broken, '语法残缺也应返回结构')

  console.log('✅ AST 分析器自测全部通过')
  console.log(`   TS: 函数${ts!.functions.length} 类${ts!.classes.length} 接口${ts!.interfaces.length}`)
  console.log(`   TSX: 组件 [${tsx!.reactComponents.join(', ')}]`)
  console.log(`   Py: 函数${py!.functions.length} 类${py!.classes.length}`)
  console.log(`   Java: 函数${java!.functions.length} 类${java!.classes.length} · Go: 函数${go!.functions.length} · C: 函数${c!.functions.length}`)
  console.log(`   C++: 函数${cpp!.functions.length} 类${cpp!.classes.length} · C#: 类${cs!.classes.length} · Rust: 函数${rust!.functions.length}`)
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
