# Dragger 1.2.5 Release Notes

发布日期：2026-02-27

## 发布信息

- 版本号：`1.2.5`
- 变更区间：`1.2.4..1.2.5`
- commit 数量：`3`（不含发布提交）
- 兼容性：无破坏性变更

## 重点更新

### 1) 拖拽手柄迁移到 Gutter 架构

- 将左侧手柄定位从 overlay/滚动补偿模式迁移为 CodeMirror gutter 绑定。
- 手柄与编辑内容同步滚动，显著降低滚动场景下的视觉延迟与漂移。
- 多行渲染块（如 callout / LaTeX）定位策略与 gutter 行号保持一致，锚定首行。

### 2) Gutter 占位与横向定位优化

- 自定义 handle gutter 列宽压缩为 `0`，不再额外挤占文本内容区域。
- 保持与其他 gutter（如行号）兼容；开启“定位到行号”时可直接按行号 gutter 对齐手柄 X 位置。
- 调整默认横向偏移配置，使手柄与正文保持更合理的视觉间距。

### 3) 多文本块删除按钮（可选功能，默认关闭）

- 新增设置项 `enableMultiSelectionDeleteButton`，默认 `false`。
- 开启后，已提交的多文本块选区会显示删除按钮，可一键删除所选块。
- 增加指针事件守卫，避免删除按钮点击与拖拽手势处理冲突。

## 完整 Commit 清单（按时间顺序）

| Commit | 类型 | 摘要 |
| --- | --- | --- |
| [`41d0c67`](https://github.com/Ariestar/obsidian-dragger/commit/41d0c67) | refactor | 迁移 drag-handle 定位到 gutter 架构。 |
| [`b027b52`](https://github.com/Ariestar/obsidian-dragger/commit/b027b52) | style | 调整默认手柄横向偏移，与正文留出间距。 |
| [`018c5c0`](https://github.com/Ariestar/obsidian-dragger/commit/018c5c0) | feat | 新增已提交多块选择删除按钮（设置可选，默认关闭）。 |

## 验证结果

- `npm run lint:review` 通过
- `npm run typecheck` 通过
- `npm run test` 通过（24 文件，188 测试）
