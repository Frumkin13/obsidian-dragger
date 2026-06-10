# Dragger 1.2.8 Release Notes

发布日期：2026-05-30

## 发布信息

- 版本号：`1.2.8`
- 变更区间：`1.2.7..1.2.8`
- 兼容性：无破坏性变更。包含桌面与移动端多选交互调整，建议升级前确认当前工作区已保存。

## 重点更新

### 1) 桌面端多选体验优化

- 桌面端多选模式下按 `Esc` 现在会退出多选并清除已选 handle。
- 移除桌面端大号浮动多选拖拽手柄，避免遮挡正文与产生额外视觉噪音。
- 多选后左侧 handle 会切换为原生已勾选 checkbox，退出多选后恢复普通 handle 外观。
- 修复从父级列表项向下移动到子级列表项时，父级 handle 持续显示、子级 handle 被隐藏的问题。

### 2) 移动端多选与拖拽稳定性

- 移动端选中背景或 handle 高亮后，可以直接拖拽已选 block。
- 移除“按住太久就取消选择”的行为，长按选择与继续拖拽的手势衔接更稳定。
- 移动端进入插件 block selection 模式时，会临时关闭 CodeMirror 编辑宿主的 `contenteditable`，避免系统弹出“全选 / Select All”原生菜单。
- 拖拽过程中阻止原生页面滚动，并改用插件控制的边缘自动滚动，顶部与底部触发区域更宽。
- 软键盘收起后，如果编辑器仍残留 CodeMirror 聚焦与空光标状态，下一次长按编辑器时会先 blur 该陈旧输入状态，并继续同一次长按拖拽意图。

### 3) 块类型转换菜单增强

- 块类型切换菜单底部新增 `Delete block` 操作。
- 删除操作使用 Obsidian 原生 warning 菜单样式显示为红色。
- 删除当前 block 时复用拖拽删除区间逻辑，处理中间块、末尾块时避免残留多余空行。

## 完整 Commit 清单（按时间顺序）

| Commit | 类型 | 摘要 |
| --- | --- | --- |
| [`d22ab1c`](https://github.com/Ariestar/obsidian-dragger/commit/d22ab1c) | fix | 在拖拽编辑前锚定选择，改善 undo 后的光标恢复。 |
| [`4a82b3b`](https://github.com/Ariestar/obsidian-dragger/commit/4a82b3b) | feat | 增强移动端 selection 体验并加入 block type conversion 菜单。 |
| [`3c67474`](https://github.com/Ariestar/obsidian-dragger/commit/3c67474) | fix | 改进移动端多选手势流程。 |
| [`ff272f1`](https://github.com/Ariestar/obsidian-dragger/commit/ff272f1) | fix | 移除 range selection connector rail。 |
| [`f7597da`](https://github.com/Ariestar/obsidian-dragger/commit/f7597da) | feat | 细化移动端 range selection handles。 |
| [`7fa9d7c`](https://github.com/Ariestar/obsidian-dragger/commit/7fa9d7c) | fix | 使本地构建路径更可移植。 |
| [`b4373f1`](https://github.com/Ariestar/obsidian-dragger/commit/b4373f1) | chore | 加载本地构建环境配置。 |
| [`8ecd2be`](https://github.com/Ariestar/obsidian-dragger/commit/8ecd2be) | fix | 统一移动端 selection handle resize 逻辑。 |
| [`720600f`](https://github.com/Ariestar/obsidian-dragger/commit/720600f) | fix | resize 后保留移动端 selection。 |
| [`d62530c`](https://github.com/Ariestar/obsidian-dragger/commit/d62530c) | fix | 稳定移动端 selection mode。 |
| [`33160f1`](https://github.com/Ariestar/obsidian-dragger/commit/33160f1) | fix | range selection 使用原生 checkbox，并移除桌面端浮动大手柄。 |
| [`b500878`](https://github.com/Ariestar/obsidian-dragger/commit/b500878) | fix | 改进移动端 selection 拖拽、contenteditable 锁定与边缘自动滚动。 |
| [`baef855`](https://github.com/Ariestar/obsidian-dragger/commit/baef855) | fix | 拖拽前清理移动端陈旧编辑器 focus 状态。 |
| [`303addc`](https://github.com/Ariestar/obsidian-dragger/commit/303addc) | fix | 修复嵌套列表 handle hover 缓存导致的父子项切换问题。 |
| [`abf8913`](https://github.com/Ariestar/obsidian-dragger/commit/abf8913) | feat | 块类型菜单新增删除当前 block 操作。 |
| [`4d69025`](https://github.com/Ariestar/obsidian-dragger/commit/4d69025) | fix | 桌面端多选支持按 Escape 退出。 |

## 验证结果

- `npm run typecheck` 通过
- `npm run lint -- --max-warnings=0` 通过
- `npm run test` 通过（36 文件，229 测试）
- `npm run build` 通过
