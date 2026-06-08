# PRD: Dragger Cross-Platform Drag and Multi-Select Interaction Refactor

> Status: Draft  
> Date: 2026-06-08  
> Scope: 拖拽交互 / 移动端多选 / drag-platform 边界 / CodeMirror 输入适配

---

## 1. 一句话目标

把 Dragger 的拖拽统一成一套平台无关的核心交互模型：

```text
Platform Adapter -> Interaction Event -> Drag State/Pipeline -> Platform Adapter Execution
```

`drag` 层不区分桌面端、移动端、CodeMirror、未来其他编辑器；它只实现抽象拖拽逻辑、选择逻辑、生命周期和 pipeline。桌面端、移动端只是 `platform` 对这套抽象逻辑的不同实现：输入方式、延迟、视觉反馈、触达方式和少量 UX 保护可以不同，但最终都应翻译成同一种 interaction event 和同一套 drag lifecycle。

---

## 2. 背景

当前代码已经有一部分核心能力：

- `drag/pipeline` 控制真正开始拖拽后的 begin / preview / commit / cancel。
- `drag/selection` 开始承接拖拽交互里的多选更新规则，底层 range 算法仍由 `domain/selection` 提供。
- `drag/mode` 开始表达交互状态，但还不应该把 mobile/desktop 或 DOM 副作用写进核心状态。
- `platform/codemirror/input` 负责读取 pointer/touch/focus 等输入。

但当前实现的边界仍然混乱：

- 平台层还在决定过多业务状态，例如 selection 是否可拖、是否进入子状态、何时退出。
- 移动端文本长按、手柄拖拽、多选拖拽之间存在多条分叉路径。
- 移动端多选后，长按选中文本区域无法拖动整个多选块，因为 input 层只识别 selected handle，不识别 selected text range。
- mobile drag mode 的语义过宽，可能错误地限制手柄拖拽；它应该只是移动端文本长按入口的 platform guard。
- 一些 UI/历史逻辑被补丁式叠加，导致行为看起来像兼容层或兜底逻辑。

---

## 3. 用户目标

### 3.1 桌面端

桌面端保持直觉一致：

- 通过手柄拖拽单个块。
- 通过长按/范围交互进入多选。
- 对已选中的块再次拖拽时，移动整个选区。
- 桌面端不需要 mobile drag mode。

### 3.2 移动端：未开启长按文本拖拽

移动端默认应尽量接近桌面端：

- 通过手柄拖拽单块。
- 通过手柄相关交互进入多选和调整多选范围。
- 不需要右上角 mobile drag mode。
- 不应因为没有开启 mobile drag mode 而禁止手柄拖拽。
- 如果当前设置不是“始终显示手柄”，移动端应由 platform 实现自己的手柄触达策略，而不是让 drag 层知道移动端差异。
- 移动端手柄触达策略可以和桌面 hover 不同，但最终仍翻译成 `source = handle` 的同一种 interaction event。

### 3.3 移动端：开启长按文本拖拽

开启“长按文本拖拽”后，移动端增加文本区域入口：

- 长按文本块：开始拖拽该块。
- 长长按文本块：进入多选模式。
- 多选模式下，长按已选中文本区域：拖拽整个多选选区。
- 由于文本长按容易误触，此模式需要 mobile drag mode 作为外部开关。
- 关闭 mobile drag mode 时，所有依赖文本长按拖拽的移动端子模式必须退出并清理 UI。

---

## 4. 非目标

本次不做：

- 不新增兼容 re-export。
- 不保留旧 selection UI 或旧 class 作为降级路径。
- 不在 drag 层为了移动端额外强制显示所有手柄。
- 不用全局兜底样式假装解决移动端手柄触达问题；移动端触达应是明确的 platform 实现。
- 不重新设计 Obsidian 命令栏样式。
- 不把 CodeMirror DOM 逻辑放进 `drag` 层。
- 不把 pointer capture、contenteditable、focus guard、scroll lock 放进 `drag` 层。
- 不一次性重写全部 drag pipeline。

---

## 5. 核心概念

### 5.1 Interaction Event

`InteractionEvent` 表示平台已经把真实输入翻译成了什么交互事件。事件名贴近用户行为，不包含 mobile/desktop。

核心事件：

```ts
type InteractionEvent =
  | { type: 'hold_start'; target: HoldTarget; guardDeps?: GuardId[] }
  | { type: 'hold_ready'; sessionId: string }
  | { type: 'drag_start'; sessionId: string; drop: DropSnapshot }
  | { type: 'drag_over'; sessionId: string; drop: DropSnapshot }
  | { type: 'drop'; sessionId: string; resolution: DropResolution }
  | { type: 'cancel'; sessionId: string; reason: DragCancelReason }
  | { type: 'selection_start'; seed: SelectionSeed; guardDeps?: GuardId[] }
  | { type: 'selection_change'; boundary: SelectionBoundary }
  | { type: 'selection_finish' }
  | { type: 'selection_clear' }
  | { type: 'guard_unavailable'; guardId: GuardId };
```

原则：

- platform 负责 hit-test、timer、移动阈值和坐标解析，然后提交事件。
- drag 负责根据当前 state 和 event 决定状态转换。
- `hold_start` 表示用户按住了一个可交互对象，但还没开始拖。
- `drag_start` 才表示真正进入拖拽。
- `drag_over` 表示拖拽经过某个 drop 目标。
- `selection_*` 是同一条 interaction pipeline 的事件，不是另一条 pipeline。

### 5.2 Drag Interaction State

drag 层只表达平台无关的交互状态。拖拽和多选融合在同一个 state machine 中：

```ts
type InteractionState =
  | { type: 'idle' }
  | { type: 'holding'; hold: HoldContext }
  | { type: 'ready_to_drag'; hold: HoldContext }
  | { type: 'selecting'; selection: SelectionContext }
  | { type: 'dragging'; drag: DragContext };

type HoldContext = {
  sessionId: string;
  target: HoldTarget;
  guardDeps: GuardId[];
};

type HoldTarget =
  {
    selection: BlockSelection;
    source: 'handle' | 'text' | 'selected_text' | 'command';
  };

type SelectionContext = {
  selection: BlockSelection;
  phase: 'passive' | 'adjusting';
  guardDeps: GuardId[];
};

type DragContext = {
  sessionId: string;
  selection: BlockSelection;
  drop: DropSnapshot | null;
  guardDeps: GuardId[];
};
```

原则：

- `HoldTarget` 不区分单块和多选；区别只在 `BlockSelection` 内容。
- `dragging.selection` 不区分单块、多块、多区域；区别只在 `BlockSelection` 内容。
- selection 是 interaction pipeline 的状态，不是移动端专属模式。
- 平台 guard 不可用时，依赖该 guard 进入的子模式必须退出。
- 子模式不复制父模式逻辑；它只是 drag lifecycle 的一个状态分支。
- drag state 不描述 DOM 副作用，不输出 focus/scroll/contenteditable 指令。
- platform 根据 drag state 和自己的 UX 规则执行输入抑制、滚动锁、pointer capture、视觉更新。

### 5.3 Selection Model

单块选择和多块选择使用同一种选择模型：

```text
BlockSelection
```

原则：

- 单块拖拽是 `BlockSelection` with one range。
- 多块拖拽是 `BlockSelection` with multiple ranges。
- 各平台共用同一套 selection 更新规则。
- `domain/selection` 负责底层 range 数据算法，例如 merge / subtract / collect / normalize。
- `drag/selection` 负责把 domain selection 算法组合成拖拽交互里的 selection update policy。
- 多区域选择的拖拽交互规则是 `drag/selection` 层能力，不应在任一 platform 重写一套。

---

## 6. 分层边界

### 6.1 domain

负责纯数据和纯算法：

- Markdown 文档块结构。
- block range merge/subtract。
- selection range 底层计算，例如 merge / subtract / collect / normalize。
- command transaction 规划。

禁止：

- DOM。
- PointerEvent / TouchEvent。
- CodeMirror / Obsidian。
- mobile / desktop 平台判断。
- selecting / dragging / holding 交互状态。

### 6.2 drag

负责平台无关的拖拽交互语义和状态机：

- interaction event 是否允许。
- holding -> ready_to_drag -> dragging。
- selection 状态生命周期。
- 外部 guard 不可用时的交互退出规则。
- dragging / drag_over / drop / cancel 生命周期。
- range selection 状态更新。
- drag interaction selection policy。

允许：

- 使用 domain 的纯算法。
- 表达抽象 input source 和 interaction phase。
- 在 `drag/selection` 中组合 `domain/selection` 的底层算法。

禁止：

- mobile / desktop 平台判断。
- DOM hit-test。
- focus guard。
- contenteditable。
- pointer capture。
- CodeMirror view dispatch。

### 6.3 platform/codemirror

负责把真实环境实现为 drag 输入和 drag 输出：

- DOM hit-test：handle / text / selected text / resize handle。
- PointerEvent / TouchEvent。
- long press / long-long-press timer 的实际执行。
- 桌面 hover 和移动端无 hover 场景下的手柄触达实现。
- pointer capture。
- focus suppression。
- scroll lock。
- CodeMirror visual classes。
- Obsidian command / view action 注册。

原则：

- platform 可以持有 timer，但 timer 到点后提交平台无关的 interaction event。
- platform 可以决定“如何触达”和“何时提交输入”，但不应自己复制 drag 状态机。
- platform 不应自己决定业务状态是否允许，只应调用 drag 层规则。
- platform 可以计算 CodeMirror 几何和 DOM 命中结果，但这只是输入翻译；不能计算 drag 业务状态、selection 语义或 pipeline 转换。
- platform 根据 drag state 执行本平台需要的 UI/DOM 副作用，例如输入抑制、滚动锁和 pointer capture。
- 移动端如果不是“始终显示手柄”，应在 platform 层实现触摸手柄的出现、命中或等价触达策略；drag 层只看到 `source = handle`。

### 6.4 plugin

负责设置和 Obsidian 集成：

- 设置项。
- 命令注册。
- view action。
- mobile drag mode 开关状态。

原则：

- plugin 不直接改 drag 状态。
- plugin 设置变化通过 driver 通知 platform，platform 再调用 drag 层规则决定是否退出子模式。

---

## 7. Interaction Pipeline

本系统只有一条 `Interaction Pipeline`。拖拽和多选都在这条 pipeline 里；多选不是独立 pipeline，移动端多选也不是独立 pipeline。

### 7.1 主路径

```text
idle
  |
  | hold_start(selection)
  v
holding
  |
  | hold_ready
  v
ready_to_drag
  |
  | drag_start(drop)
  v
dragging
  |
  | drag_over(drop)*
  v
dragging
  |
  | drop(resolution) / cancel
  v
idle
```

含义：

- `idle`: 没有交互。
- `holding`: 用户按住了可交互对象，但还没确认拖拽。
- `ready_to_drag`: 长按/延迟条件已满足，下一次有效移动可以开始拖。
- `dragging`: 正在拖一个 `BlockSelection`。
- `drag_over`: 正在拖过某个 drop 目标；由 platform 解析坐标得到 `DropSnapshot`。
- `drop`: platform 解析最终 `DropResolution`，drag 产出提交生命周期。
- `cancel`: guard 失效、pointer cancel、Escape 或 session interrupted。

### 7.2 多选分支

多选是同一条 pipeline 的状态分支：

```text
idle
  |
  | hold_start(selection)
  v
holding
  |
  | selection_start(seed)
  v
selecting
  |
  | selection_change(boundary)*
  v
selecting
  |
  | selection_finish
  v
selecting(passive)
```

选区也可以回到主拖拽路径：

```text
selecting
  |
  | hold_start(selection)
  v
holding
  |
  | hold_ready
  v
ready_to_drag
  |
  | drag_start(drop)
  v
dragging(selection)
  |
  | drag_over(drop)*
  v
dragging(selection)
  |
  | drop / cancel
  v
idle
```

合并图：

```text
idle
  |
  | hold_start(selection)
  v
holding
  |
  +-- selection_start(seed)
  |     v
  |   selecting(adjusting)
  |     |
  |     | selection_change(boundary)*
  |     v
  |   selecting(adjusting)
  |     |
  |     | selection_finish
  |     v
  |   selecting(passive)
  |     |
  |     | hold_start(current selection)
  |     v
  |   holding
  |
  +-- hold_ready
        v
      ready_to_drag
        |
        | drag_start(drop)
        v
      dragging(selection)
        |
        | drag_over(drop)*
        v
      dragging(selection)
        |
        | drop / cancel
        v
      idle
```

核心约束：

- `dragging(selection)` 是唯一拖拽状态。
- 单块拖拽、多块拖拽、多区域拖拽完全同路。
- 区别只在 `BlockSelection` 的 ranges 内容。
- selection range 更新由 `drag/pipeline` 调用 `drag/selection` policy；`drag/selection` 内部复用 `domain/selection` 底层算法。

### 7.3 平台映射

桌面端手柄拖拽：

```text
pointerdown(handle)
-> platform hit-test: HoldTarget(selection = one block, source = handle)
-> hold_start
-> hold_ready / drag_start
-> dragging(BlockSelection)
```

移动端手柄拖拽：

```text
touch pointerdown(handle)
-> platform handle affordance / hit-test: HoldTarget(selection = one block, source = handle)
-> hold_start
-> platform delay policy
-> hold_ready / drag_start
-> dragging(BlockSelection)
```

移动端文本长按拖拽：

```text
touch pointerdown(text)
-> platform hit-test: HoldTarget(selection = one block, source = text)
-> require enableMobileTextLongPressDrag
-> require text-drag guard if setting requires it
-> hold_start(guardDeps = ['text-drag-mode'])
-> platform long-press timer
-> hold_ready / drag_start
-> dragging(BlockSelection)
```

移动端长长按进入多选：

```text
touch pointerdown(text)
-> platform hit-test: HoldTarget(selection = one block, source = text)
-> hold_start
-> platform long-long-press timer
-> selection_start(seed)
-> selecting(passive)
```

调整多选范围：

```text
pointerdown(selection resize handle)
-> selection_start / selection_change
-> selecting(adjusting)
-> selection_finish
-> selecting(passive)
```

拖拽已选区：

```text
pointerdown(selected text or selected handle)
-> HoldTarget(selection = current selection, source = selected_text | handle)
-> hold_start
-> hold_ready
-> drag_start
-> dragging(current BlockSelection)
```

关闭 mobile drag mode：

```text
plugin setting/action changes mobile drag availability
-> platform converts it to guard_unavailable('text-drag-mode')
-> drag exits/cancels any interaction whose guardDeps include that guard
-> platform clears UI and side effects
```

### 7.4 Pipeline 验收

- 桌面端不受 mobile drag mode 影响。
- 手柄拖拽不受 mobile drag mode 影响。
- 文本长按拖拽可以受 `text-drag-mode` guard 保护。
- 如果手柄设置不是“始终显示”，移动端 platform 必须提供明确的手柄触达实现；不能依赖桌面 hover。
- 移动端多选后，长按选中文本区域可以拖拽整个选区。
- 多选支持多区域选择。
- selection passive 可滚动；platform 可根据 `selecting.phase` 决定是否锁滚动。
- guard 失效时，依赖该 guard 的 interaction 自动退出或取消。

---

## 8. Exit Rules

退出规则属于 drag core 的状态机逻辑。platform 可以触发退出事件，也负责执行 DOM/UI 清理，但不应该自己复制退出状态机。

### 8.1 全局退出事件

以下事件可以从任何非 idle 状态触发：

```text
cancel(reason)
guard_unavailable(guardId)
selection_clear
destroy
```

规则：

- `cancel(reason)` 结束当前 holding / ready_to_drag / dragging / selecting(adjusting) 交互。
- `guard_unavailable(guardId)` 只影响 `guardDeps` 包含该 guard 的当前状态。
- `selection_clear` 只清理 `selecting` 状态，不应取消无关的 active handle drag。
- `destroy` 无条件回到 `idle`。
- 所有 terminal path 必须最终回到 `idle`，或者明确回到 `selecting(passive)`。
- 退出操作必须幂等；重复 cancel / clear 不应产生二次副作用。

### 8.2 holding / ready_to_drag 退出

```text
holding --cancel(press_cancelled)--> idle
ready_to_drag --cancel(press_cancelled)--> idle
holding --guard_unavailable(dep)--> idle, if depends on dep
ready_to_drag --guard_unavailable(dep)--> idle, if depends on dep
```

常见触发：

- pointer up before drag start。
- move 超过取消阈值但还没 ready。
- Escape。
- blur / visibility hidden。
- 依赖的 platform guard 被关闭。

### 8.3 dragging 退出

```text
dragging --drop(resolution)--> idle
dragging --cancel(reason)--> idle
dragging --guard_unavailable(dep)--> idle, if depends on dep
```

规则：

- `drop(resolution)` 是提交路径。
- `cancel(reason)` 是取消路径。
- `drop` 和 `cancel` 都是 terminal event。
- terminal 后 drag core 清空 `DragContext`。
- platform 收到 terminal lifecycle 后清理 drop preview、source visual、pointer capture、scroll lock、timers。

### 8.4 selecting(adjusting) 退出

```text
selecting(adjusting) --selection_finish--> selecting(passive)
selecting(adjusting) --cancel(pointer_cancelled)--> selecting(passive) | idle
selecting(adjusting) --guard_unavailable(dep)--> idle, if depends on dep
```

规则：

- 正常结束范围调整后进入 `selecting(passive)`。
- cancel 后如果仍有有效 `BlockSelection`，回到 `selecting(passive)`。
- cancel 后如果没有有效 selection，回到 `idle`。
- `selecting(adjusting)` 可以让 platform 锁滚动；退出 adjusting 后必须释放。

### 8.5 selecting(passive) 退出

```text
selecting(passive) --selection_clear--> idle
selecting(passive) --hold_start(current selection)--> holding
selecting(passive) --guard_unavailable(dep)--> idle, if depends on dep
selecting(passive) --external_selection_invalid--> idle
```

常见触发：

- Escape。
- 用户点击空白区域或明确取消选区。
- 多选设置关闭。
- 文档变化导致 selection range 不合法。
- 依赖的 platform guard 被关闭。
- drop 成功后。

规则：

- `selecting(passive)` 不应该持有 pointer capture。
- `selecting(passive)` 不应该锁滚动。
- `selecting(passive)` 可以抑制文本输入，具体由 platform UX 决定。

### 8.6 Platform Cleanup Contract

drag core 只输出状态变化和 lifecycle，不清 DOM。

platform 必须在退出路径清理：

- active timers。
- pointer capture。
- document/window listeners。
- drop preview。
- source highlight。
- selection visual。
- scroll lock。
- focus/input guards。

---

## 9. 设置语义

### 9.1 `enableMobileTextLongPressDrag`

控制移动端是否允许从文本区域发起拖拽。

影响：

- `false`: 文本长按不拖拽，移动端主要通过手柄拖拽。
- `true`: 文本长按可以拖拽，文本长长按可以进入多选。

### 9.2 `requireMobileDragMode`

只在 `enableMobileTextLongPressDrag === true` 时有意义。

影响：

- 保护文本长按拖拽，降低误触。
- 不保护手柄拖拽。
- 不保护桌面端。
- 在 drag 层不表现为 “mobile mode”，而表现为 platform 传入的 `text-drag guard available/unavailable`。

### 9.3 `mobileDragModeEnabled`

运行时开关。

影响：

- 允许或禁止文本长按拖拽入口。
- 关闭时退出依赖文本长按 guard 产生的 selection / drag 子模式。

---

## 10. UI/UX 要求

### 10.1 桌面端

- 维持现有手柄和选区样式。
- 多选后使用与单块选中一致的整体框选视觉。

### 10.2 移动端

- 不由 drag 层强制显示所有手柄。
- 如果当前不是“始终显示手柄”，platform 必须实现移动端可用的手柄触达方式，例如触摸命中区、临时显示当前块手柄、或等价的 handle affordance。
- 移动端手柄触达方式可以不同于桌面 hover，但必须翻译成同一个 `handle` input source。
- 不新增自定义右上角样式；如需要按钮，使用 Obsidian view action。
- mobile drag mode 状态应通过图标状态表达，不用会遮挡 view action 的黑色提示。
- 多选后使用整体框选视觉，不重写一套背景高亮。
- passive selection 可滚动。
- active drag / resize 才锁滚动。

---

## 11. 当前问题清单

### P0

- 移动多选后，长按选中文本区域不能拖拽整个选区。
- mobile drag mode 语义过宽，可能错误限制手柄拖拽。
- platform input 层承担过多业务状态判断。
- 移动端无 hover 时的手柄触达还没有明确 platform 实现，导致把显示策略误补成全局样式的风险。

### P1

- selection 生命周期和 external guard 的关系需要完全由 drag 规则表达。
- 桌面和移动多选范围逻辑必须完全统一。
- 清理未使用的旧 overlay / selection UI / 兼容路径。

### P2

- 测试名称和结构需要反映新模型：interaction event、interaction state、platform translation、platform side effects。
- 文档化 drag/platform/domain 边界。

---

## 12. 验收标准

### 12.1 功能验收

- 桌面端手柄拖拽单块正常。
- 桌面端多选后拖拽整个选区正常。
- 移动端未开启文本长按拖拽时，手柄拖拽正常，不需要 mobile drag mode。
- 移动端在非“始终显示手柄”设置下，仍有明确 platform 手柄触达实现。
- 移动端开启文本长按拖拽但 mobile drag mode 关闭时，文本长按不拖拽。
- 移动端开启文本长按拖拽且 mobile drag mode 开启时，文本长按拖拽单块正常。
- 移动端长长按文本进入多选正常。
- 移动端多选后，长按选中文本区域拖拽整个选区正常。
- 移动端多选支持多区域选择。
- 关闭 mobile drag mode 时，依赖 text-drag guard 进入的 selection 自动退出并清理 UI。

### 12.2 架构验收

- `drag` 不 import CodeMirror / Obsidian / DOM。
- `domain` 不 import platform / drag。
- `drag` 不包含 mobile / desktop 分支。
- `platform/codemirror` 可以 import `drag` 和 `domain`，但业务状态规则应调用 drag 层。
- 不存在兼容 re-export。
- 不存在未使用的旧 selection UI 文件。
- 不存在移动端单独重写一套 range selection 算法。

### 12.3 测试验收

必须覆盖：

- interaction pipeline 状态关系。
- drag interaction state 转换。
- platform 根据 state 执行输入抑制和滚动锁。
- handle drag 不受 mobile drag mode 限制。
- text long press drag 受 mobile drag mode 限制。
- 移动端非“始终显示手柄”时的 platform handle affordance。
- selecting passive 可滚动。
- selecting adjusting / dragging 时 platform 可锁滚动。
- selected text long press -> dragging current selection。
- text-drag guard off -> exit dependent interaction state。
- desktop/mobile range selection 共用算法。

---

## 13. Target Drag File Architecture

本次 PRD 不重新设计 `domain`。`domain` 当前已经承接块、选择、命令、事务等纯算法，drag 只依赖它即可。后续如发现 domain 缺少某个纯函数，再按最小范围补充，不在本 PRD 里重画 domain 结构。

本次需要精确设计的是 `src/drag` 和 `src/platform/codemirror`。

### 13.1 当前 drag 结构

当前文件：

```text
src/drag/
  architecture-boundary.spec.ts
  drop/
    drag-drop-snapshot.ts
  effects/
    drag-effect.ts
    drag-effect-executor.ts
  intent/
    drag-intent.ts
    drag-intent.spec.ts
  lifecycle/
    drag-lifecycle.ts
    drag-lifecycle-emitter.ts
    drag-lifecycle-protocol.ts
  mode/
    drag-interaction-mode.ts
    drag-interaction-mode.spec.ts
  pipeline/
    drag-controller.ts
    drag-controller.spec.ts
    drag-flow-controller.ts
    drag-input.ts
  selection/
    block-range-selection.ts
    block-range-selection.spec.ts
  state/
    drag-session.ts
    drag-state.ts
```

当前问题：

- `pipeline` 只覆盖已经进入 active drag 后的 begin / preview / commit / cancel。
- `intent` 只是简单 facts -> intent，不是主 pipeline。
- `mode` 里出现 mobile-specific interaction mode，和目标边界冲突。
- `effects` 包含 `show_drop_preview` 这类 platform-ish 输出，容易把 DOM 视觉职责带进 drag。
- `state` 只描述 `ActiveDrag`，不包含 holding / ready_to_drag / selecting。
- `lifecycle` 事件还停留在 `drag_started / drag_target_changed / drag_drop_commit` 这条 active drag 线，不能完整表达 selection 和 holding 生命周期。

### 13.2 目标 drag 结构

目标结构只保留两个核心目录：`pipeline` 和 `selection`。`state`、`intent`、`effects` 仍然是需要的概念，但不作为目录存在：

- state -> `pipeline/pipeline-state.ts`
- intent -> `pipeline/pipeline-event.ts`
- effects -> `pipeline/pipeline-output.ts`

目标文件精确到具体文件：

```text
src/drag/
  index.ts
  architecture-boundary.spec.ts

  pipeline/
    pipeline-event.ts
    pipeline-state.ts
    pipeline-output.ts
    pipeline-reducer.ts
    pipeline-exit.ts
    pipeline-guard.ts
    pipeline-drop.ts
    pipeline-reducer.spec.ts
    pipeline-exit.spec.ts
    pipeline-drop.spec.ts

  selection/
    block-range-selection.ts
    block-range-selection.spec.ts
```

### 13.3 目标 drag 文件职责和行数估算

```text
src/drag/index.ts                               10-25 lines
```

- 统一导出 drag public API。
- 不导出兼容旧路径。

```text
src/drag/pipeline/pipeline-event.ts             60-90 lines
```

- 定义 `PipelineEvent`。
- 定义 `HoldTarget`、`GuardId`、`DragCancelReason`。
- 覆盖 `hold_start`、`hold_ready`、`selection_start`、`selection_change`、`selection_finish`、`selection_clear`、`drag_start`、`drag_over`、`drop`、`cancel`、`guard_unavailable`、`destroy`。
- 不包含 `PointerEvent`、`TouchEvent`、CodeMirror 类型、mobile/desktop 类型。

```text
src/drag/pipeline/pipeline-state.ts             70-110 lines
```

- 定义 `PipelineState`：
  - `idle`
  - `holding`
  - `ready_to_drag`
  - `selecting`
  - `dragging`
- 定义 `HoldContext`、`SelectionContext`、`DragContext`。
- 定义 `HoldTarget` 使用的 `BlockSelection` 结构引用。
- 不出现 mobile / desktop。

```text
src/drag/pipeline/pipeline-output.ts            50-80 lines
```

- 定义 reducer 输出。
- 输出只描述 core 事实，例如：
  - `state_changed`
  - `selection_changed`
  - `drag_over`
  - `dropped`
  - `cancelled`
  - `command_ready`
- 不包含 `show_drop_preview`、`hide_drop_preview`、`lock_scroll`、`suppress_focus`、`set_pointer_capture` 这类 platform 指令。

```text
src/drag/pipeline/pipeline-reducer.ts           140-220 lines
```

- 核心状态机：
  - `reducePipeline(state, event) -> { state, outputs }`
- 负责：
  - `idle -> holding`
  - `holding -> ready_to_drag`
  - `holding -> selecting`
  - `selecting(passive) -> holding`
  - `ready_to_drag -> dragging`
  - `dragging -> idle`
- 不执行 command。
- 不执行 DOM side effects。
- 如果超过 220 行，优先在同目录内拆为 `pipeline-hold.ts` 和 `pipeline-select.ts`，`pipeline-reducer.ts` 只做分发，不新增目录。

```text
src/drag/pipeline/pipeline-exit.ts              80-130 lines
```

- 集中处理退出规则：
  - `cancel`
  - `guard_unavailable`
  - `selection_clear`
  - `destroy`
  - invalid selection
- 保证 terminal path 回到 `idle` 或明确回到 `selecting(passive)`。
- 这是 lifecycle 清理语义，不执行 platform 清理动作。

```text
src/drag/pipeline/pipeline-guard.ts             30-60 lines
```

- 定义 guard dependency 工具函数：
  - `dependsOnGuard(state, guardId)`
  - `withGuardDeps(...)`
- guard 只是抽象字符串依赖，不知道 mobile drag mode。

```text
src/drag/pipeline/pipeline-drop.ts              90-140 lines
```

- 处理 `dragging` 后的 drop 阶段纯逻辑。
- 定义或导入 `DropSnapshot`、`DropResolution`。
- 处理 `drag_start`、`drag_over`、`drop`、`cancel` 的纯状态输出。
- 不输出 platform preview 指令。

```text
src/drag/selection/block-range-selection.ts     100-160 lines
```

- 保留为 drag interaction selection policy/helper。
- 负责在 `selection_start` / `selection_change` / `selection_finish` 语义下计算下一份 `BlockSelection`。
- 组合 `domain/selection` 的 merge / subtract / collect / normalize 底层算法。
- 支持多区域选择的拖拽交互规则。
- 不沉淀底层通用 selection 算法。
- 不能知道移动端或桌面端。

测试行数估算：

```text
pipeline-reducer.spec.ts                        180-300 lines
pipeline-exit.spec.ts                           120-220 lines
pipeline-drop.spec.ts                           120-220 lines
block-range-selection.spec.ts                   180-300 lines
```

### 13.4 当前 drag 文件到目标文件映射

```text
当前: drag/drop/drag-drop-snapshot.ts
目标: drag/pipeline/pipeline-drop.ts
说明: DropSnapshot 是抽象数据，可以留在 drag；不得包含 preview DOM 数据。

当前: drag/effects/drag-effect.ts
目标: drag/pipeline/pipeline-output.ts
说明: 删除 show/hide preview effect；preview 属于 platform。

当前: drag/effects/drag-effect-executor.ts
目标: 删除
说明: drag core 不执行 effects；platform 消费 pipeline output。

当前: drag/intent/drag-intent.ts
目标: drag/pipeline/pipeline-event.ts
说明: intent 不再是独立 facts mapper；统一成 PipelineEvent。

当前: drag/lifecycle/drag-lifecycle.ts
目标: drag/pipeline/pipeline-output.ts 或删除
说明: lifecycle 不单独成目录；对外事实由 output 表达。

当前: drag/lifecycle/drag-lifecycle-emitter.ts
目标: platform 或 plugin 层
说明: emitter 是运行时集成，不是 drag core state machine。

当前: drag/lifecycle/drag-lifecycle-protocol.ts
目标: 删除
说明: 不保留协议兼容层。

当前: drag/mode/drag-interaction-mode.ts
目标: drag/pipeline/pipeline-state.ts + pipeline-exit.ts
说明: 不保留 mobile-specific mode，也不保留兼容 re-export。

当前: drag/pipeline/drag-controller.ts
目标: drag/pipeline/pipeline-drop.ts
说明: active drag 后的 drop 逻辑并入统一 pipeline/drop 阶段。

当前: drag/pipeline/drag-flow-controller.ts
目标: drag/pipeline/pipeline-reducer.ts
说明: activeDrag 内部状态并入统一 PipelineState。

当前: drag/pipeline/drag-input.ts
目标: drag/pipeline/pipeline-event.ts + pipeline-drop.ts
说明: 输入事件和 drop resolution 分开。

当前: drag/selection/block-range-selection.ts
目标: 保留
说明: 作为 drag interaction selection update policy；底层通用 selection 算法留在 domain/selection。

当前: drag/state/drag-state.ts
目标: drag/pipeline/pipeline-state.ts
说明: ActiveDrag 变成 DragContext。

当前: drag/state/drag-session.ts
目标: 并入 drag/pipeline/pipeline-state.ts 或删除
说明: sessionId 是 PipelineState 的字段，不单独形成旧 session 层。
```

### 13.5 drag layer rules

- `drag/pipeline` owns the unified interaction state machine.
- `drag/pipeline` owns active drop flow as one stage of the same pipeline.
- `drag/selection` owns drag-interaction selection update policy built from `domain/selection` primitives.
- `drag` may depend on `domain`.
- `drag` must not import `platform`, CodeMirror, Obsidian, DOM, or CSS selector constants.
- `drag` must not contain mobile/desktop branches.
- `drag` must not output DOM side-effect commands such as focus suppression, scroll lock, pointer capture, or preview rendering.

---

## 14. Target CodeMirror Platform File Architecture

`platform/codemirror` 的目标不是变薄到只剩转发。它要负责真实环境的实现：DOM hit-test、Pointer/Touch、timer、CodeMirror dispatch、预览 UI、输入抑制、滚动锁、Obsidian view action。它不能复制 drag 状态机。

CodeMirror 内部的桌面端、移动端、手柄入口、文本长按入口必须共用同一个 `pipeline-adapter` 流程；各端只允许在 hit-test、timer、触达方式和 side effects 上不同，不能维护各自独立的 drag / selection pipeline。

### 14.1 当前 CodeMirror 结构

当前目录：

```text
src/platform/codemirror/
  command/
    move-command-decision.ts
  drop/
    drop-resolution.ts
    drop-target-resolver.ts
    list-drop-target-resolver.ts
  extension/
    active-drag-registry.ts
    drag-driver.ts
    drag-perf-session-manager.ts
    editor-context.ts
    editor-dom-sync.ts
    editor-extension.ts
    editor-lifecycle.ts
    editor-update.ts
    global-pointermove-router.ts
    gutter.ts
    handle-gutter-extension.ts
    hover-pointer-snapshot.ts
    hover-pointer-types.ts
    perf-session.ts
    perf-time.ts
    semantic-refresh-scheduler.ts
  input/
    interaction-cleanup.ts
    interaction-state.ts
    pointer-drag-controller.ts
    pointer-drag-target-router.ts
    pointer-input.ts
    pointer-selecting-actions.ts
    pointer-session-controller.ts
    pointerdown-action.ts
    pointerdown-handler.ts
    pointermove-handler.ts
    pointerup-handler.ts
    range-selection-gesture-state.ts
    touch-interaction-controller.ts
    touch-selecting-actions.ts
  preview/
    drop-indicator.ts
    handle-renderer.ts
    handle-visibility-controller.ts
    range-selection-visual-manager.ts
    source-line-visual.ts
  selection/
    block-boundary-resolver.ts
    block-selection-ranges.ts
    block-selection-resolver.ts
    geometry.ts
    range-selection-anchor.ts
    rect-calculator.ts
    selection-grip-hit.ts
  transaction/
    move-command-applier.ts
    transaction-applier.ts
    undo-selection-anchor.ts
```

注意：`platform/codemirror/selection` 不是 selection 状态层，而是 CodeMirror geometry -> selection input resolver。

当前问题：

- `input/pointer-drag-controller.ts` 过长，混合了 pointer session、selection、drag、platform side effects 和部分状态规则。
- `input/touch-selecting-actions.ts` 过长，移动端多选逻辑容易和 drag core 分叉。
- `preview/range-selection-visual-manager.ts` 过长，存在重写 selection 视觉的风险。
- `extension/drag-driver.ts` 过长，driver 同时承担集成和业务编排。
- `drop/*` 和 `selection/*` 里有 CodeMirror 几何解析是合理的，但不应保存 drag lifecycle 状态。

### 14.2 目标 CodeMirror 结构

目标结构保留现有大类，但把“翻译输入到 drag pipeline”和“执行 drag output”明确成平台职责：

```text
src/platform/codemirror/
  command/
    move-command-decision.ts

  drop/
    codemirror-drop-snapshot.ts
    drop-target-resolver.ts
    list-drop-target-resolver.ts

  extension/
    drag-driver.ts
    editor-context.ts
    editor-dom-sync.ts
    editor-extension.ts
    editor-lifecycle.ts
    editor-update.ts
    global-pointermove-router.ts
    gutter.ts
    handle-gutter-extension.ts
    hover-pointer-snapshot.ts
    hover-pointer-types.ts
    semantic-refresh-scheduler.ts

  input/
    pipeline-adapter.ts
    pointer-session.ts
    pointer-hit-test.ts
    pointer-hold.ts
    pointer-drag.ts
    pointer-selection.ts
    touch-delay-policy.ts
    mobile-handle-affordance.ts
    input-guards.ts
    input-cleanup.ts

  preview/
    drop-indicator.ts
    handle-renderer.ts
    handle-visibility-controller.ts
    range-selection-visual-manager.ts
    source-line-visual.ts

  selection/
    block-boundary-resolver.ts
    block-selection-ranges.ts
    block-selection-resolver.ts
    geometry.ts
    range-selection-anchor.ts
    rect-calculator.ts
    selection-grip-hit.ts

  transaction/
    move-command-applier.ts
    transaction-applier.ts
    undo-selection-anchor.ts
```

### 14.3 目标 CodeMirror 文件职责和行数估算

```text
command/move-command-decision.ts                60-100 lines
```

- 把 drag drop result 转成移动命令决策。
- 不读取 DOM。
- 不持有 interaction state。

```text
drop/codemirror-drop-snapshot.ts                60-100 lines
```

- 把 CodeMirror 坐标、行信息、列表上下文转成 drag core 可理解的 `DropSnapshot`。
- 替代当前 platform/drop 和 drag/drop 边界不清的命名。

```text
drop/drop-target-resolver.ts                    220-320 lines
drop/list-drop-target-resolver.ts               220-320 lines
```

- 保留 CodeMirror 几何和列表语义解析。
- 只负责 resolver，不保存 drag session。
- 如果单文件继续超过 320 行，按解析阶段拆同目录 helper，不新增 pipeline 概念。

```text
extension/drag-driver.ts                        120-200 lines
```

- CodeMirror extension 的集成入口。
- 创建 adapter、预览管理器、transaction applier、cleanup。
- 连接 plugin setting/view action 到 platform guard。
- 不实现 pointer 手势细节。

```text
extension/editor-context.ts                     60-90 lines
extension/editor-dom-sync.ts                    40-80 lines
extension/editor-extension.ts                   40-80 lines
extension/editor-lifecycle.ts                   40-70 lines
extension/editor-update.ts                      40-80 lines
```

- 保留编辑器上下文、生命周期和更新同步。
- 不引入 drag pipeline 状态规则。

```text
extension/global-pointermove-router.ts          80-130 lines
extension/gutter.ts                             30-70 lines
extension/handle-gutter-extension.ts            50-90 lines
extension/hover-pointer-snapshot.ts             40-80 lines
extension/hover-pointer-types.ts                20-50 lines
extension/semantic-refresh-scheduler.ts         50-90 lines
```

- 保留 platform integration 能力。
- hover 只属于桌面端手柄触达实现，不进入 drag core。

```text
input/pipeline-adapter.ts                       120-200 lines
```

- CodeMirror input 和 drag pipeline 的唯一主适配器。
- 接收 `PointerEvent` / `TouchEvent` 转译后的平台事实。
- 调用 `reducePipeline`。
- 把 `PipelineOutput` 分发给 preview、transaction、cleanup。
- 不自己复制 holding/selecting/dragging 规则。

```text
input/pointer-session.ts                        90-140 lines
```

- 管理 pointerId、start point、last point、button、modifier、capture 状态。
- 不决定业务状态。

```text
input/pointer-hit-test.ts                       120-200 lines
```

- 负责 DOM hit-test。
- 输出平台无关的 hit target：
  - handle
  - text
  - selected_text
  - selection grip
  - drop target input
- 不进入 drag 状态转换。

```text
input/pointer-hold.ts                           100-160 lines
```

- 负责 hold timer 和 hold movement threshold。
- timer 到点后提交 `hold_ready` 或 `selection_start`。
- 不区分最终是单块还是多块；目标 selection 已由 hit-test 决定。

```text
input/pointer-drag.ts                           120-180 lines
```

- 把 move/up/cancel 翻译成 `drag_start`、`drag_over`、`drop`、`cancel`。
- 调用 drop resolver 获取 `DropSnapshot` / `DropResolution`。
- 不保存独立 active drag 状态。

```text
input/pointer-selection.ts                      120-180 lines
```

- 把 selection grip / long-long-press 后的边界变化翻译成 `selection_change` / `selection_finish`。
- 不计算 selection 结果。
- 不调用 `drag/selection` policy。
- selection 结果由 `drag/pipeline` 调用 `drag/selection` 计算。

```text
input/touch-delay-policy.ts                     60-100 lines
```

- 只表达移动端 touch 延迟策略：
  - long press
  - long-long press
  - movement cancel threshold
- 不知道 selection lifecycle。

```text
input/mobile-handle-affordance.ts               80-140 lines
```

- 当手柄设置不是“始终显示”时，实现移动端可触达手柄。
- 可以临时显示当前块手柄、扩大命中区或等价触达。
- 最终必须输出 `source = handle` 的同一种 pipeline event。
- 不修改 drag core。

```text
input/input-guards.ts                           80-130 lines
```

- 执行 platform side effects：
  - focus suppression
  - contenteditable guard
  - scroll lock
  - pointer capture
- 根据 `PipelineState` 和 platform UX 规则执行。
- 不决定 pipeline 状态。

```text
input/input-cleanup.ts                          70-120 lines
```

- 清理 timer、pointer capture、window/document listener、input guard、scroll lock。
- 被 terminal output、editor destroy、view update invalidation 调用。

```text
preview/drop-indicator.ts                       100-160 lines
preview/handle-renderer.ts                      40-80 lines
preview/handle-visibility-controller.ts         140-220 lines
preview/range-selection-visual-manager.ts       120-200 lines
preview/source-line-visual.ts                   40-80 lines
```

- 只执行视觉更新。
- range selection 视觉复用单块选中整体框选样式。
- 不重写 selection 算法。

```text
selection/block-boundary-resolver.ts            60-100 lines
selection/block-selection-ranges.ts             50-90 lines
selection/block-selection-resolver.ts           160-240 lines
selection/geometry.ts                           70-120 lines
selection/range-selection-anchor.ts             60-100 lines
selection/rect-calculator.ts                    90-140 lines
selection/selection-grip-hit.ts                 80-130 lines
```

- 这是 geometry-to-selection-input resolver，不是 selection state owner。
- 可以读取 CodeMirror 文档位置和 DOM 几何。
- 可以解析 block / range / boundary / grip hit target。
- 输出 `SelectionSeed` / `SelectionBoundary` 给 `drag/pipeline`。
- 可以依赖 `domain` 数据结构。
- 不保存 `selecting(passive/adjusting)` 状态。
- 不计算 next `BlockSelection`。
- 不执行 merge / subtract selection ranges。
- 不决定 add / remove operation。
- 不调用 `drag/selection` policy。
- 不持有 pipeline state。

```text
transaction/move-command-applier.ts             160-240 lines
transaction/transaction-applier.ts              40-80 lines
transaction/undo-selection-anchor.ts            40-80 lines
```

- 负责 CodeMirror transaction 和 undo anchor。
- 只消费 drop/command result。
- 不知道 mobile/desktop。

测试行数估算：

```text
input/pipeline-adapter.spec.ts                  180-320 lines
input/pointer-hold.spec.ts                      160-260 lines
input/pointer-selection.spec.ts                 180-320 lines
input/mobile-handle-affordance.spec.ts          120-220 lines
preview/range-selection-visual-manager.spec.ts  120-220 lines
```

### 14.4 当前 CodeMirror 文件到目标文件映射

```text
当前: input/pointer-drag-controller.ts
目标: input/pipeline-adapter.ts + pointer-session.ts + pointer-hold.ts + pointer-drag.ts + pointer-selection.ts
说明: 当前大控制器拆成输入适配、pointer session、hold、drag、selection 五块。

当前: input/interaction-state.ts
目标: 删除或收缩到 pointer-session.ts
说明: platform 不再保存业务 interaction state；业务状态来自 drag/pipeline。

当前: input/interaction-cleanup.ts
目标: input/input-cleanup.ts
说明: 保留 platform 清理职责，但由 pipeline terminal output 驱动。

当前: input/pointer-drag-target-router.ts
目标: input/pointer-hit-test.ts
说明: 命中判断保留在 platform，输出统一 hit target。

当前: input/pointer-input.ts
目标: input/pipeline-adapter.ts
说明: 输入入口归并到 adapter。

当前: input/pointer-selecting-actions.ts
目标: input/pointer-selection.ts
说明: selection action 只翻译事件，不复制 range selection 算法。

当前: input/pointer-session-controller.ts
目标: input/pointer-session.ts
说明: session 只保存 pointer 技术状态。

当前: input/pointerdown-action.ts
目标: input/pointer-hit-test.ts + pointer-hold.ts
说明: pointerdown 先 hit-test，再进入 hold。

当前: input/pointerdown-handler.ts / pointermove-handler.ts / pointerup-handler.ts
目标: input/pipeline-adapter.ts + pointer-drag.ts + pointer-selection.ts
说明: handler 薄化为事件路由。

当前: input/range-selection-gesture-state.ts
目标: 删除或收缩到 pointer-selection.ts
说明: 选择状态进入 drag/pipeline；platform 只保留 grip gesture 的临时坐标。

当前: input/touch-interaction-controller.ts
目标: input/touch-delay-policy.ts + pointer-hold.ts
说明: touch 差异是 delay policy，不是独立状态机。

当前: input/touch-selecting-actions.ts
目标: input/pointer-selection.ts + touch-delay-policy.ts
说明: 移动端不重写一套多选；只提供 long-long-press 和 touch 边界输入。

当前: preview/range-selection-visual-manager.ts
目标: 保留但瘦身
说明: 只画整体框选，不重复背景高亮和 selection 状态。

当前: preview/handle-visibility-controller.ts
目标: preview/handle-visibility-controller.ts + input/mobile-handle-affordance.ts
说明: 视觉显示和移动端可触达策略分开。

当前: extension/drag-driver.ts
目标: extension/drag-driver.ts
说明: 保留集成入口，但移出手势细节和状态规则。

当前: drop/drop-resolution.ts
目标: drop/codemirror-drop-snapshot.ts 或 command/move-command-decision.ts
说明: CodeMirror drop 解析留在 platform；抽象 drop 类型留在 drag/pipeline。
```

### 14.5 CodeMirror layer rules

- `platform/codemirror/input` owns browser input translation and timers.
- desktop/mobile/handle/text inputs must all converge into the same `platform/codemirror/input/pipeline-adapter.ts` flow.
- `platform/codemirror/input` may hold pointer technical state, but must not own drag business state.
- `platform/codemirror/preview` owns DOM visual updates only.
- `platform/codemirror/drop` owns CodeMirror geometry to drop snapshot resolution.
- `platform/codemirror/selection` owns CodeMirror geometry to block/range resolution.
- `platform/codemirror/transaction` owns CodeMirror document mutation.
- `platform/codemirror/extension` owns Obsidian/CodeMirror integration and wiring.
- CodeMirror resolver may compute geometry, but must not compute drag business state or selection semantics.
- mobile/desktop differences stay in platform input/preview, never in drag core.

---

## 15. 推荐实施顺序

1. 固化平台无关的 `PipelineEvent`、`PipelineState`、`PipelineOutput`。
2. 删除 drag 层 mobile/desktop 概念，只保留 input source、guard dependency、phase。
3. 把 mobile drag mode gating 改成 platform text-drag guard：只限制 text source，不限制 handle source。
4. 把 `pointer-drag-controller.ts` 拆成 CodeMirror platform adapter、pointer session、hold、drag、selection。
5. 为移动端非“始终显示手柄”补明确的 platform handle affordance。
6. 让 selected text long press 生成平台无关的 `hold_start(selection)` event。
7. 把 selection 生命周期判断收束到 drag pipeline 规则。
8. 删除 platform 中重复的业务判断和旧 UI 死代码。
9. 增加架构边界测试，防止 CodeMirror/mobile 逻辑回流进 drag。
10. 跑完整 typecheck、lint、focused tests、full tests、build。

---

## 16. 开放问题

- “长长按进入多选”的默认时间是否仍使用当前设置项，还是单独拆出移动端多选延迟设置？
- 选中文本区域的 hit-test 是否按整块 source outline 判断，还是按具体 selected line DOM 判断？
- 多区域选择移动端是否允许从任一选中区域长按拖拽整个 selection？
- 关闭 mobile drag mode 时，如果当前正在 active drag，应该 cancel 还是允许本次 drag 完成？
- 移动端非“始终显示手柄”时的最佳 handle affordance 是临时显示手柄、扩大命中区，还是提供和文本长按不同的触摸入口？
