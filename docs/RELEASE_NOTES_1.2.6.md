# Dragger 1.2.6 Release Notes

发布日期：2026-03-22

## 发布信息

- 版本号：`1.2.6`
- 变更区间：`1.2.5..1.2.6`
- commit 数量：`16`（不含发布提交）
- 兼容性：无破坏性变更

## 重点更新

### 1) 多文本块拖拽与移动语义稳定性修复

- 连续多文本块选择现在按“可多选的单块组合”统一建模，避免连续块被错误当成复杂 composite 分支处理。
- 修复从已选 handle 开始拖拽后，源位置残留旧多选连线与把手高亮的问题。
- 统一多块移动、跨编辑器移动与原地层级调整的插入策略，列表缩进意图、列表 marker 类型可以正确保留。
- 移动块时补齐折叠状态恢复，降低同文档双窗口和复杂列表场景下的视觉/结构错位风险。

### 2) Range Selection 架构与视觉链路重整

- 将 range selection 拆分为更聚焦的 selection state / flow / overlay / anchor 模块，降低后续交互分支继续堆叠在单文件内的复杂度。
- 调整选择手势仲裁与连线层级，减少拖拽、框选、删除按钮等交互之间的冲突。
- 修复 range selection anchor 与 handle、block hit 之间的对齐问题，使左侧连线与 grip 命中区域更一致。

### 3) Handle Gutter 与交互性能优化

- 新增可配置的 handle gutter 放置方式，并继续细化 gutter 绑定后的横向定位职责。
- 简化 drop target 与 semantic refresh 路径，补充全局 pointermove 路由与视图更新调度，减少热点路径上的重复工作。
- 将原生行号 gutter 从拖拽/多选视觉链中完全解耦，不再为了视觉联动逐行扫描行号 DOM。
- range selection overlay 改为单次预计算 blocks / segments / anchor snapshot，避免重复归一化与重复几何扫描。

### 4) 模块边界与内部结构整理

- 继续整理 `core / features / platform / shared` 模块边界，收拢共享契约与平台适配层职责。
- 清理未使用代码、旧定位实现和冗余测试资产，为后续继续演进拖拽与多选交互留下更清晰的结构基础。

## 完整 Commit 清单（按时间顺序）

| Commit | 类型 | 摘要 |
| --- | --- | --- |
| [`a573963`](https://github.com/Ariestar/obsidian-dragger/commit/a573963) | fix | 修复 range selection anchor 与 handle、block hit 的对齐。 |
| [`9e13c96`](https://github.com/Ariestar/obsidian-dragger/commit/9e13c96) | fix | 修复 range-selection probe 语法与 lint 问题。 |
| [`8b46da2`](https://github.com/Ariestar/obsidian-dragger/commit/8b46da2) | refactor | 拆分多段 range selection 模块。 |
| [`1998a11`](https://github.com/Ariestar/obsidian-dragger/commit/1998a11) | refactor | 重组 range-selection 架构与测试布局。 |
| [`759dc83`](https://github.com/Ariestar/obsidian-dragger/commit/759dc83) | refactor | 重组模块结构与共享契约。 |
| [`202f7fe`](https://github.com/Ariestar/obsidian-dragger/commit/202f7fe) | feat | 优化 selection 手势仲裁与 connector layering。 |
| [`8629e7e`](https://github.com/Ariestar/obsidian-dragger/commit/8629e7e) | fix | 保留拖拽插入后的源列表 marker 类型。 |
| [`5ee8b24`](https://github.com/Ariestar/obsidian-dragger/commit/5ee8b24) | feat | 移动块时保留折叠状态。 |
| [`e440f0c`](https://github.com/Ariestar/obsidian-dragger/commit/e440f0c) | perf | 移除未使用代码并优化滚动性能。 |
| [`0a79f72`](https://github.com/Ariestar/obsidian-dragger/commit/0a79f72) | improve(ui) | 细化 gutter 绑定后的 handle 定位。 |
| [`950650c`](https://github.com/Ariestar/obsidian-dragger/commit/950650c) | refactor | 拆分 handle 定位职责。 |
| [`8e949b2`](https://github.com/Ariestar/obsidian-dragger/commit/8e949b2) | feat | 增加可配置的 handle gutter 放置方式。 |
| [`ddc6f86`](https://github.com/Ariestar/obsidian-dragger/commit/ddc6f86) | refactor | 简化 drop target 与 semantic refresh 路径。 |
| [`5fcd9cf`](https://github.com/Ariestar/obsidian-dragger/commit/5fcd9cf) | perf | 优化 handle 交互性能。 |
| [`5725752`](https://github.com/Ariestar/obsidian-dragger/commit/5725752) | fix | 规范多文本块拖拽分组并清理陈旧选择状态。 |
| [`7a1ddcd`](https://github.com/Ariestar/obsidian-dragger/commit/7a1ddcd) | refactor | 解耦行号视觉联动并预计算 selection anchors。 |

## 验证结果

- `npm run build` 通过
- `npm run lint:review` 通过
- `npm run typecheck` 通过
- `npm run test` 通过（34 文件，206 测试）
