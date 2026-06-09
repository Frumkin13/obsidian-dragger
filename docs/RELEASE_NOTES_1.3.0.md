# Dragger 1.3.0 Release Notes

2026-06-09

## 中文

### 发布信息

- 版本号：`1.3.0`
- 变更区间：`1.2.8..1.3.0`
- 兼容性：包含 drag pipeline、平台层交互、移动端多选和块类型转换重构，建议升级前确认当前工作区已保存。

### 重点更新

#### 1) Drag Pipeline 与架构分层

- 拖拽架构现在明确分为三层：`domain` 负责纯 Markdown 计算和命令规划，`drag` 负责 `DragPipeline` 生命周期，`platform` 只消费前两层能力并实现 CodeMirror/Obsidian 相关的输入翻译、预览 UI、移动端手势和实际 transaction。[[44d886f](https://github.com/Ariestar/obsidian-dragger/commit/44d886f)] [[4939341](https://github.com/Ariestar/obsidian-dragger/commit/4939341)] [[42a56d5](https://github.com/Ariestar/obsidian-dragger/commit/42a56d5)]
- `DragPipeline` 成为拖拽会话的生命周期对象：hold、selection、drag、drop、exit 都从统一事件入口推进，并用 output 描述 platform 要做的 UI/UX 副作用，减少平台层自己维护并猜测状态的分叉路径。[[0f5dd49](https://github.com/Ariestar/obsidian-dragger/commit/0f5dd49)] [[a5a4e2e](https://github.com/Ariestar/obsidian-dragger/commit/a5a4e2e)] [[6a9138a](https://github.com/Ariestar/obsidian-dragger/commit/6a9138a)]
- Range selection、普通 block drag、selected text drag 和移动端 handle resize 都被翻译成统一的 selection/range/pipeline 输入，桌面端和移动端只保留“如何选中”的平台差异，不再各自实现拖拽生命周期。[[34250a0](https://github.com/Ariestar/obsidian-dragger/commit/34250a0)] [[8019930](https://github.com/Ariestar/obsidian-dragger/commit/8019930)] [[9af4efd](https://github.com/Ariestar/obsidian-dragger/commit/9af4efd)] [[0da0bf4](https://github.com/Ariestar/obsidian-dragger/commit/0da0bf4)]
- Headless drag core 被整理为 npm 可消费的核心包，并更新 `domain`、`drag`、`markdown` 等子路径导出，让后续非 Obsidian 平台可以复用计算层和生命周期层，而不是复制平台适配代码。[[91e48d8](https://github.com/Ariestar/obsidian-dragger/commit/91e48d8)] [[dae7a30](https://github.com/Ariestar/obsidian-dragger/commit/dae7a30)] [[e43733c](https://github.com/Ariestar/obsidian-dragger/commit/e43733c)]

#### 2) 移动端多选与拖拽 UX

- 移动端新增 drag mode toggle，让工具栏可以进入插件控制的拖拽和多选流程。[[1486721](https://github.com/Ariestar/obsidian-dragger/commit/1486721)] [[d97c39e](https://github.com/Ariestar/obsidian-dragger/commit/d97c39e)]
- 移动端 range selection 现在走统一 pipeline，追加不连续选择、拖拽已选文本和 selection lifecycle 不再各走一套旧逻辑。[[0da0bf4](https://github.com/Ariestar/obsidian-dragger/commit/0da0bf4)] [[68b8751](https://github.com/Ariestar/obsidian-dragger/commit/68b8751)] [[34250a0](https://github.com/Ariestar/obsidian-dragger/commit/34250a0)]
- 选中背景、handle、resize handle 的稳定性被修复，移动端选中第二个不连续块、长按已选块、拖拽切换阶段时不再依赖旧 fallback。[[9fb1132](https://github.com/Ariestar/obsidian-dragger/commit/9fb1132)] [[9f6eee9](https://github.com/Ariestar/obsidian-dragger/commit/9f6eee9)] [[ce08103](https://github.com/Ariestar/obsidian-dragger/commit/ce08103)]
- 移动端点击进入拖拽模式后可以从目标行打开块类型菜单，复用同一套块命令入口。[[eb7cad6](https://github.com/Ariestar/obsidian-dragger/commit/eb7cad6)]

#### 3) 折叠块、列表与 drop target

- 折叠列表和折叠标题作为 drop target 时的落点计算被修正，避免落到折叠块内部或错过目标块边界。[[f5b6e1a](https://github.com/Ariestar/obsidian-dragger/commit/f5b6e1a)]
- 移动折叠列表或折叠标题后会保留源块和目标块的 folded state。[[a4bb100](https://github.com/Ariestar/obsidian-dragger/commit/a4bb100)] [[d11e573](https://github.com/Ariestar/obsidian-dragger/commit/d11e573)]
- 源块插入空白 slot 或被 displaced target 挤开时，折叠列表状态恢复逻辑被补齐。[[4fcf41b](https://github.com/Ariestar/obsidian-dragger/commit/4fcf41b)]
- 感谢 [@florianmodel](https://github.com/florianmodel) 贡献 linked note drop target 能力；1.3.0 在架构重组后继续保留这条跨文件拖拽路径。[[d5feab2](https://github.com/Ariestar/obsidian-dragger/commit/d5feab2)] [[2375b21](https://github.com/Ariestar/obsidian-dragger/commit/2375b21)] [[966b94c](https://github.com/Ariestar/obsidian-dragger/commit/966b94c)] [[44d886f](https://github.com/Ariestar/obsidian-dragger/commit/44d886f)]
- Drop editor context 与旧 drag 死代码被清理，为后续 pipeline 化减少重复入口。[[c8ff794](https://github.com/Ariestar/obsidian-dragger/commit/c8ff794)] [[038eadc](https://github.com/Ariestar/obsidian-dragger/commit/038eadc)]

#### 4) 块类型菜单与 Markdown 转换

- 块类型菜单重新组织为 Paragraph、Heading、List、Quote、Code block、Math block 等层级，Heading 支持 H1-H6。[[25a080c](https://github.com/Ariestar/obsidian-dragger/commit/25a080c)] [[f84ebee](https://github.com/Ariestar/obsidian-dragger/commit/f84ebee)]
- 底部复制、剪切、删除操作改为三栏图标按钮，并压缩菜单图标、字号和按钮间距。[[25a080c](https://github.com/Ariestar/obsidian-dragger/commit/25a080c)] [[b8ff05c](https://github.com/Ariestar/obsidian-dragger/commit/b8ff05c)] [[6e2a36d](https://github.com/Ariestar/obsidian-dragger/commit/6e2a36d)]
- Quote 转换会先清理 `>` 前缀，避免 quote 转 paragraph、heading、list 或 code block 后残留引用语法。[[0f450d0](https://github.com/Ariestar/obsidian-dragger/commit/0f450d0)] [[42a56d5](https://github.com/Ariestar/obsidian-dragger/commit/42a56d5)]
- Fenced code block 转换会移除首尾 fence 并保留代码正文，避免 code block 转其他块类型时残留围栏语法。[[42a56d5](https://github.com/Ariestar/obsidian-dragger/commit/42a56d5)]
- Math block 转换接入同一套 fenced block pipeline，支持 `$$` 包裹、解除包裹，以及 code block 和 math block 之间互转。[[f84ebee](https://github.com/Ariestar/obsidian-dragger/commit/f84ebee)]
- 纯 Markdown block type conversion planning 被移到 domain 层，plugin 层只负责当前 block 定位和 CodeMirror dispatch。[[42a56d5](https://github.com/Ariestar/obsidian-dragger/commit/42a56d5)]

#### 5) 本地化与文档

- 感谢 [@Frumkin13](https://github.com/Frumkin13) 贡献俄语本地化，并移除旧字符串。[[84f13f9](https://github.com/Ariestar/obsidian-dragger/commit/84f13f9)] [[ab02910](https://github.com/Ariestar/obsidian-dragger/commit/ab02910)] [[f2d7f36](https://github.com/Ariestar/obsidian-dragger/commit/f2d7f36)] [[c92daa2](https://github.com/Ariestar/obsidian-dragger/commit/c92daa2)] [[790d44c](https://github.com/Ariestar/obsidian-dragger/commit/790d44c)]
- README 徽章和社区链接被更新，便于用户找到发布信息、源码和社区入口。[[38773fe](https://github.com/Ariestar/obsidian-dragger/commit/38773fe)]

## English

### Release Info

- Version: `1.3.0`
- Changes: `1.2.8..1.3.0`
- Compatibility: includes drag pipeline, platform interaction, mobile multi-selection, and block type conversion refactors; save active notes before upgrading.

### Highlights

#### 1) Drag Pipeline And Architecture Boundaries

- The drag architecture now has three explicit layers: `domain` handles pure Markdown calculation and command planning, `drag` owns the `DragPipeline` lifecycle, and `platform` consumes both layers to implement CodeMirror/Obsidian input translation, preview UI, mobile gestures, and actual transactions. [[44d886f](https://github.com/Ariestar/obsidian-dragger/commit/44d886f)] [[4939341](https://github.com/Ariestar/obsidian-dragger/commit/4939341)] [[42a56d5](https://github.com/Ariestar/obsidian-dragger/commit/42a56d5)]
- `DragPipeline` is now the lifecycle object for a drag session: hold, selection, drag, drop, and exit progress through one event entry point, while outputs describe the UI/UX side effects platform code should apply. [[0f5dd49](https://github.com/Ariestar/obsidian-dragger/commit/0f5dd49)] [[a5a4e2e](https://github.com/Ariestar/obsidian-dragger/commit/a5a4e2e)] [[6a9138a](https://github.com/Ariestar/obsidian-dragger/commit/6a9138a)]
- Range selection, single block drag, selected text drag, and mobile handle resize are translated into shared selection/range/pipeline inputs, so desktop and mobile keep only platform-specific selection gestures instead of separate lifecycle implementations. [[34250a0](https://github.com/Ariestar/obsidian-dragger/commit/34250a0)] [[8019930](https://github.com/Ariestar/obsidian-dragger/commit/8019930)] [[9af4efd](https://github.com/Ariestar/obsidian-dragger/commit/9af4efd)] [[0da0bf4](https://github.com/Ariestar/obsidian-dragger/commit/0da0bf4)]
- The headless drag core is packaged for npm consumers with updated `domain`, `drag`, and `markdown` subpath exports, so future non-Obsidian platforms can reuse the calculation and lifecycle layers instead of copying platform adapter code. [[91e48d8](https://github.com/Ariestar/obsidian-dragger/commit/91e48d8)] [[dae7a30](https://github.com/Ariestar/obsidian-dragger/commit/dae7a30)] [[e43733c](https://github.com/Ariestar/obsidian-dragger/commit/e43733c)]

#### 2) Mobile Multi-Selection And Drag UX

- Mobile now has a drag mode toggle for entering plugin-controlled drag and multi-selection flows from the toolbar. [[1486721](https://github.com/Ariestar/obsidian-dragger/commit/1486721)] [[d97c39e](https://github.com/Ariestar/obsidian-dragger/commit/d97c39e)]
- Mobile range selection now goes through the unified pipeline, so appending disjoint selections, dragging selected text, and selection lifecycle handling no longer use separate legacy paths. [[0da0bf4](https://github.com/Ariestar/obsidian-dragger/commit/0da0bf4)] [[68b8751](https://github.com/Ariestar/obsidian-dragger/commit/68b8751)] [[34250a0](https://github.com/Ariestar/obsidian-dragger/commit/34250a0)]
- Selected backgrounds, handles, and resize handles were stabilized so selecting a second disjoint block, holding a selected block, and switching drag phases no longer depend on old fallback behavior. [[9fb1132](https://github.com/Ariestar/obsidian-dragger/commit/9fb1132)] [[9f6eee9](https://github.com/Ariestar/obsidian-dragger/commit/9f6eee9)] [[ce08103](https://github.com/Ariestar/obsidian-dragger/commit/ce08103)]
- Tapping a target line in mobile drag mode can open the block type menu through the same block command entry point. [[eb7cad6](https://github.com/Ariestar/obsidian-dragger/commit/eb7cad6)]

#### 3) Folded Blocks, Lists, And Drop Targets

- Drop target resolution for collapsed lists and headings was corrected so drops do not land inside folded content or miss block boundaries. [[f5b6e1a](https://github.com/Ariestar/obsidian-dragger/commit/f5b6e1a)]
- Moving collapsed lists or headings now preserves folded state on the moved block and the affected target block. [[a4bb100](https://github.com/Ariestar/obsidian-dragger/commit/a4bb100)] [[d11e573](https://github.com/Ariestar/obsidian-dragger/commit/d11e573)]
- Folded list restoration was completed for blank-slot insertion and displaced target positions. [[4fcf41b](https://github.com/Ariestar/obsidian-dragger/commit/4fcf41b)]
- Thanks to [@florianmodel](https://github.com/florianmodel) for the linked note drop target work; 1.3.0 keeps that cross-file drag path after the architecture rework. [[d5feab2](https://github.com/Ariestar/obsidian-dragger/commit/d5feab2)] [[2375b21](https://github.com/Ariestar/obsidian-dragger/commit/2375b21)] [[966b94c](https://github.com/Ariestar/obsidian-dragger/commit/966b94c)] [[44d886f](https://github.com/Ariestar/obsidian-dragger/commit/44d886f)]
- Drop editor context and dead drag code were cleaned up to reduce duplicate entry points before the pipeline refactor. [[c8ff794](https://github.com/Ariestar/obsidian-dragger/commit/c8ff794)] [[038eadc](https://github.com/Ariestar/obsidian-dragger/commit/038eadc)]

#### 4) Block Type Menu And Markdown Conversion

- The block type menu is reorganized into Paragraph, Heading, List, Quote, Code block, and Math block groups, with Heading support from H1 through H6. [[25a080c](https://github.com/Ariestar/obsidian-dragger/commit/25a080c)] [[f84ebee](https://github.com/Ariestar/obsidian-dragger/commit/f84ebee)]
- Copy, cut, and delete actions now use three icon-only bottom buttons, and the menu icon size, font size, and spacing were tightened. [[25a080c](https://github.com/Ariestar/obsidian-dragger/commit/25a080c)] [[b8ff05c](https://github.com/Ariestar/obsidian-dragger/commit/b8ff05c)] [[6e2a36d](https://github.com/Ariestar/obsidian-dragger/commit/6e2a36d)]
- Quote conversion now clears the `>` prefix before converting quote blocks to paragraph, heading, list, or code block. [[0f450d0](https://github.com/Ariestar/obsidian-dragger/commit/0f450d0)] [[42a56d5](https://github.com/Ariestar/obsidian-dragger/commit/42a56d5)]
- Fenced code block conversion now removes wrapping fences while preserving code content when converting to other block types. [[42a56d5](https://github.com/Ariestar/obsidian-dragger/commit/42a56d5)]
- Math block conversion now uses the same fenced block pipeline, supporting `$$` wrapping, unwrapping, and code block / math block rewrapping. [[f84ebee](https://github.com/Ariestar/obsidian-dragger/commit/f84ebee)]
- Pure Markdown block type conversion planning moved into the domain layer, leaving plugin code to resolve the current block and dispatch CodeMirror transactions. [[42a56d5](https://github.com/Ariestar/obsidian-dragger/commit/42a56d5)]

#### 5) Localization And Docs

- Thanks to [@Frumkin13](https://github.com/Frumkin13), Russian localization was added and obsolete strings were removed. [[84f13f9](https://github.com/Ariestar/obsidian-dragger/commit/84f13f9)] [[ab02910](https://github.com/Ariestar/obsidian-dragger/commit/ab02910)] [[f2d7f36](https://github.com/Ariestar/obsidian-dragger/commit/f2d7f36)] [[c92daa2](https://github.com/Ariestar/obsidian-dragger/commit/c92daa2)] [[790d44c](https://github.com/Ariestar/obsidian-dragger/commit/790d44c)]
- README badges and community links were updated so users can find release, source, and community entry points more easily. [[38773fe](https://github.com/Ariestar/obsidian-dragger/commit/38773fe)]
