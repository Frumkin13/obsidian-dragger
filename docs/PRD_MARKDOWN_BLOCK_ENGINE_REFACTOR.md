# PRD: Dragger Minimal Block Command Engine Refactor

> Status: Draft  
> Date: 2026-06-07  
> Scope: 架构重构 / Markdown 块操作引擎 / Obsidian 适配

---

## 1. 一句话目标

把 Dragger 从“Obsidian 里的拖拽实现”重构成：

```text
Block Command Engine + Drag UI + Platform Adapter
```

核心不是 drag，也不是 drop，而是：

```text
BlockSelection + BlockCommand -> BlockTransaction
```

拖拽、多行选择、删除、转换块类型、缩进，最终都应该变成对 `BlockSelection` 执行一个 `BlockCommand`，然后生成一个纯文本 `BlockTransaction`。

---

## 2. 当前问题

当前代码的问题不是功能多，而是主语错了。

现在主语是：

```text
drag / drop / move / preview / runtime
```

导致不同模块都在知道太多东西：

- drag 知道 Markdown 规则；
- drop planner 知道 DOM 坐标和 visual geometry；
- block mover 直接 dispatch CodeMirror changes；
- selection 逻辑散落在 pipeline / state / preview / move；
- runtime 变成总大脑；
- shared 容易变成垃圾桶。

目标是把主语改成：

```text
选中了哪些块 -> 要执行什么块命令 -> 生成什么文本事务
```

---

## 3. 非目标

本次重构不追求：

- 创建很多新目录；
- 创建复杂 rule registry；
- 立刻拆成 npm package；
- 立刻支持所有 Markdown 编辑器；
- 为未来可能性提前设计大型插件系统；
- 把 `drag` 改名成 `interaction`；
- 把视觉层单独抽成大型 `render` 层。

本次重构追求：

- 更少核心概念；
- 更硬依赖边界；
- 更统一数据流；
- 更少特殊分支；
- 更容易测试；
- 可逐步迁移。

---

## 4. 核心对象

整个系统只围绕 5 个核心对象。

### 4.1 `BlockIndex`

回答：Markdown 文档里有哪些块。

```ts
interface BlockIndex {
  blocks: readonly BlockNode[];
  getBlockById(id: BlockId): BlockNode | null;
  getBlockAtLine(lineNumber: number): BlockNode | null;
  getParent(blockId: BlockId): BlockNode | null;
  getChildren(blockId: BlockId): readonly BlockNode[];
}
```

它统一处理：

- paragraph
- heading section
- list item subtree
- task list
- blockquote
- callout
- table
- code fence
- math fence
- yaml frontmatter

要求：上层模块不再各自扫描 Markdown。

---

### 4.2 `BlockSelection`

回答：当前选中了哪些块。

```ts
interface BlockSelection {
  ranges: readonly BlockSelectionRange[];
  anchorBlockId: BlockId;
  focusBlockId: BlockId;
}

interface BlockSelectionRange {
  startBlockId: BlockId;
  endBlockId: BlockId;
  startLine: number;
  endLine: number;
}
```

核心原则：

```text
单块选择 = ranges.length === 1 的 BlockSelection
```

不再维护单块拖拽和多行选择两套模型。

---

### 4.3 `BlockCommand`

回答：要对选中的块做什么。

```ts
type BlockCommand =
  | { type: 'move'; selection: BlockSelection; target: DropTarget }
  | { type: 'delete'; selection: BlockSelection }
  | { type: 'convert'; selection: BlockSelection; to: BlockType }
  | { type: 'indent'; selection: BlockSelection; direction: 'in' | 'out' };
```

拖拽只是生成 `move` command 的一种 UI 方式。

---

### 4.4 `DropTarget`

回答：move command 的目标位置。

```ts
interface DropTarget {
  targetLineNumber: number;
  placement: 'before' | 'after' | 'inside';
  listIntent?: {
    mode: 'sibling' | 'child' | 'outdent';
    targetIndentWidth?: number;
  };
}
```

注意：`DropTarget` 不包含：

- `clientX`
- `clientY`
- `HTMLElement`
- `DOMRect`
- `EditorView`

坐标到 `DropTarget` 的转换属于 `platform`。

---

### 4.5 `BlockTransaction`

回答：执行 command 后产生哪些文本变化。

```ts
interface BlockTransaction {
  changes: TextChange[];
  selectionAfter?: BlockSelection | null;
  effects?: BlockEffect[];
}

interface TextChange {
  from: number;
  to: number;
  insert: string;
}
```

核心层只生成 transaction，不直接执行。

---

## 5. 目标目录结构

保持简单，只保留 4 个主层级：

```text
src/
  domain/
    block/
    markdown/
    selection/
    command/
    transaction/

  drag/
    input/
    state/
    selection/
    source/
    pipeline/
    preview/

  platform/
    codemirror/
    dom/
    obsidian/

  plugin/
    main.ts
    settings.ts
    block-type-menu.ts
    mobile-toolbar-commands.ts
    i18n/

  shared/
    constants.ts
```

说明：

- `domain`：纯 Markdown block command engine；
- `drag`：用户交互层，负责产生 selection / command；
- `platform`：CodeMirror / DOM / Obsidian 适配；
- `plugin`：Obsidian 插件外壳；
- `shared`：只放真正全局常量，不能放业务类型。

不新增顶层 `interaction`、`render`、大型 `runtime`。

---

## 6. 依赖关系

### 6.1 允许依赖

```text
plugin   -> platform
plugin   -> drag
plugin   -> domain public API

platform -> domain public API
platform -> drag public API only when wiring UI events

drag     -> domain public API
```

### 6.2 禁止依赖

```text
domain   -> drag
domain   -> platform
domain   -> plugin

drag     -> platform implementation
drag     -> plugin
drag     -> obsidian

drag     -> @codemirror/view       // 长期禁止；过渡期只允许在旧 controller 中 known violation

domain   -> @codemirror/view
domain   -> HTMLElement
domain   -> PointerEvent
domain   -> DOMRect
domain   -> window/document
```

### 6.3 依赖图

最终应该是单向的：

```text
plugin
  ├─> drag ──────> domain
  └─> platform ──> domain
```

`drag` 和 `platform` 不应该互相深度依赖。

它们通过 plugin 或轻量 wiring 组合：

```text
drag 产生 point / command request
platform 把 point 转成 DropTarget，并执行 BlockTransaction
```

---

## 7. 各层职责

### 7.1 `domain/`

职责：

```text
Markdown text -> BlockIndex
BlockSelection + BlockCommand -> BlockTransaction
```

建议文件：

```text
domain/block/
  block-types.ts
  block-index.ts
  block-detector.ts
  block-guards.ts

domain/markdown/
  line-map.ts
  line-parser.ts
  fence-scanner.ts
  indent-calculator.ts

domain/selection/
  block-selection.ts

domain/command/
  block-command.ts
  drop-target.ts

domain/transaction/
  block-transaction.ts
  move-blocks.ts
  delete-blocks.ts
  convert-blocks.ts
  document-change.ts
  text-mutation-policy.ts
```

保留现有文件名时的定位：

| 当前文件 | 新定位 |
|---|---|
| `block-detector.ts` | BlockIndex 的内部 detector |
| `line-map.ts` | BlockIndex 的底层 line index |
| `container-policy.ts` | move-blocks 的 domain rule helper |
| `drop-validation.ts` | move-blocks 的 validation helper |
| `text-mutation-policy.ts` | 纯 insert text policy |
| `document-change.ts` | 纯 TextChange 计算 |

核心 public API：

```ts
buildBlockIndex(doc): BlockIndex
planBlockCommand(doc, index, command): BlockTransaction | CommandReject
```

---

### 7.2 `drag/`

职责：

```text
用户输入 -> BlockSelection / BlockCommand
```

`drag` 不负责 Markdown 规则，不负责文本修改，不负责 CodeMirror dispatch。

建议结构：

```text
drag/input/
  drag-input.ts
  pointer-session-controller.ts
  touch-interaction-controller.ts

drag/state/
  drag-state.ts

drag/selection/
  selection-controller.ts
  selection-actions.ts

drag/source/
  source.ts
  source-ranges.ts

drag/pipeline/
  drag-controller.ts
  pointerdown-pipeline.ts
  pointermove-pipeline.ts
  pointerup-pipeline.ts

drag/preview/
  drop-indicator.ts
  handle-renderer.ts
  handle-visibility-controller.ts
  range-selection-visual-manager.ts
```

说明：

- 不新增 `gesture/`；当前 `drag/input` 已足够表达 pointer/touch/long-press 输入归一；
- 新增或强化 `drag/selection`，因为多行选择是一等公民；
- `drag/preview` 暂时保留，不单独拆顶层 render，避免目录过度工程化。

`drag` 可以使用：

- `BlockSelection`
- `BlockCommand`
- `DropTarget` 类型

但不能自己 plan mutation。

---

### 7.3 `platform/`

职责：把宿主环境翻译成 domain 能理解的东西，并执行 transaction。

建议结构：

```text
platform/codemirror/
  text-document-adapter.ts
  drop-target-resolver.ts
  apply-transaction.ts
  geometry.ts
  gutter.ts
  rect-calculator.ts
  undo-selection-anchor.ts

platform/dom/
  element-probe.ts
  embed-probe.ts
  line-dom.ts
  table-guard.ts

platform/obsidian/
  app-adapter.ts
  editor-view.ts
  editor-fold.ts
  workspace.ts
```

关键转换：

```text
EditorView.state.doc -> TextDocument
clientX/clientY       -> DropTarget
BlockTransaction      -> view.dispatch
Obsidian fold state   -> platform-only effect
```

---

### 7.4 `plugin/`

职责：Obsidian 插件外壳。

保留：

```text
plugin/main.ts
plugin/settings.ts
plugin/block-type-menu.ts
plugin/mobile-toolbar-commands.ts
plugin/i18n/
```

`plugin` 可以组装 `drag`、`platform`、`domain`，但不写 block command 业务逻辑。

---

## 8. 主数据流

所有功能必须尽量走同一条路径。

### 8.1 拖拽移动

```text
pointer down/move/up
  -> drag 形成 BlockSelection
  -> platform 将 pointer point 解析成 DropTarget
  -> drag 生成 { type: 'move', selection, target }
  -> domain planBlockCommand(...)
  -> BlockTransaction
  -> platform applyTransaction(...)
  -> drag preview clear/update
```

### 8.2 删除块

```text
用户触发 delete
  -> drag/plugin 提供 BlockSelection
  -> domain command { type: 'delete', selection }
  -> BlockTransaction
  -> platform applyTransaction
```

### 8.3 转换块类型

```text
block type menu
  -> plugin 生成 { type: 'convert', selection, to }
  -> domain planBlockCommand
  -> BlockTransaction
  -> platform applyTransaction
```

---

## 9. 防屎山规则

### 9.1 文件存在规则

新增文件前必须回答：

1. 输入是什么？
2. 输出是什么？
3. 它属于 domain / drag / platform / plugin 哪一层？
4. 它是否同时知道 UI 和 Markdown？如果是，禁止。

### 9.2 核心输出限制

大部分核心函数输出应该是以下之一：

```text
BlockIndex
BlockSelection
BlockCommand
BlockTransaction
TextChange[]
```

如果输出不是这些，要解释为什么。

### 9.3 行数限制

软限制：

```text
单文件 > 400 行：需要说明为什么不能拆
单文件 > 600 行：必须拆或提交豁免说明
imports > 15：必须审查依赖是否泄漏
```

### 9.4 `shared` 限制

`shared` 不能放业务类型。

以下类型不允许在 `shared`：

- BlockSelection
- BlockCommand
- DropTarget
- BlockTransaction
- Markdown rule types

它们必须归属到 `domain`。

---

## 10. 当前重点迁移

### Phase 1: 建立 command 核心类型

新增：

```text
domain/selection/block-selection.ts
domain/command/block-command.ts
domain/command/drop-target.ts
domain/transaction/block-transaction.ts
```

验收：

- 单块拖拽也能表达为 `BlockSelection`；
- `BlockCommand` 和 `BlockTransaction` 类型稳定；
- 不改变用户行为。

---

### Phase 2: Selection 一统单选和多选

任务：

- 让 drag source 基于 `BlockSelection`；
- `primaryBlock` 改成 helper，而不是核心状态；
- `drag/selection` 收拢 selection action；
- preview 只消费 `BlockSelection`。

验收：

- 单块拖拽、多行选择拖拽测试通过；
- 删除单选/多选双模型分支。

---

### Phase 3: BlockIndex 成为唯一 block 语义入口

任务：

- 用现有 `block-detector.ts` + `line-map.ts` 构建 `BlockIndex`；
- drop/move/source 不再自己扫描 Markdown；
- heading/list/callout/table/fence 统一由 `BlockIndex` 回答。

验收：

- Markdown fixture tests 覆盖 BlockIndex；
- 上层模块不直接调用底层 detector，除非是 BlockIndex builder。

---

### Phase 4: block-mover 改为 transaction planner

任务：

- 将 `drag/move/block-mover.ts` 的文本变化计算迁到 `domain/transaction/move-blocks.ts`；
- 输出 `BlockTransaction`；
- 新增 `platform/codemirror/apply-transaction.ts` 执行 dispatch；
- fold state 留在 `platform/obsidian`。

验收：

- domain move 测试不需要 EditorView；
- `view.dispatch` 不出现在 domain / drag。

---

### Phase 5: drop-planner 降级为 move command helper

任务：

- 坐标解析迁到 `platform/codemirror/drop-target-resolver.ts`；
- Markdown drop 合法性留在 `domain/transaction/move-blocks.ts` 或 helper；
- visual geometry 留在 `drag/preview` 或 platform geometry；
- `drag/drop` 目录逐步消失。

验收：

- domain 不出现 `clientX/clientY/HTMLElement/DOMRect`；
- drag 不负责 Markdown drop validation。

---

### Phase 6: plugin 负责轻量 wiring，避免 runtime 大脑

任务：

- 不新增大型 runtime 层；
- 如保留 `runtime/editor-runtime.ts`，它只能做 mount/update/destroy；
- 业务逻辑必须在 domain / drag / platform。

验收：

- `editor-runtime.ts` 不再是 30 imports 的总大脑；
- 它不判断 list/callout/table；
- 它不构造 insert text。

---

## 11. 测试策略

### 11.1 Domain fixture tests

用 Markdown 文本测试：

```text
input markdown
+ BlockCommand
-> output markdown
```

覆盖：

- move
- delete
- convert
- indent
- list renumber
- heading section
- callout
- table
- fence

### 11.2 Drag tests

测试交互状态，不测 Markdown mutation。

覆盖：

- pointer down
- long press
- range selection
- drag start
- drag cancel
- drag commit command generation

### 11.3 Platform tests

测试宿主适配。

覆盖：

- point -> DropTarget
- transaction -> CodeMirror dispatch
- table cell detection
- embed detection
- fold state adapter

---

## 12. 成功指标

架构指标：

- `domain` 零 DOM / Obsidian / CodeMirror View 依赖；
- `drag` 不执行 mutation；
- `platform` 是唯一 dispatch 层；
- `BlockSelection` 是唯一 selection model；
- `BlockCommand` 是唯一操作入口；
- `BlockTransaction` 是唯一 mutation output。

代码指标：

- 生产代码从当前约 12k LOC 降到 7k-9k LOC；
- 最大核心文件控制在 400 行左右；
- `drag-controller.ts` 不再是总大脑；
- `block-mover.ts` 不再作为执行器存在；
- `drop-planner.ts` 不再混坐标、规则、visual、mutation。

产品指标：

- 多行选中默认支持；
- 单块拖拽是多行选择特例；
- 当前核心拖拽能力不降级；
- 未来可以适配非 Obsidian Markdown 编辑器。

---

## 13. 最终判断

最优雅的结构不是更多层，而是更少主语。

Dragger 的核心主语应该是：

```text
BlockSelection + BlockCommand -> BlockTransaction
```

目录只服务于这条链路：

```text
domain   负责计划 command

drag     负责产生 command

platform 负责解析宿主输入和执行 transaction

plugin   负责 Obsidian 外壳
```

任何模块如果同时知道 UI、Markdown 规则、DOM geometry 和文本 mutation，就是未来屎山来源。
