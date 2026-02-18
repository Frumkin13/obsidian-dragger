# Dragger 1.2.3 Release Notes

发布日期：2026-02-18

## 发布信息

- 版本号：`1.2.3`
- 变更区间：`1.2.2..1.2.3`
- commit 数量：`20`（含发布提交）
- 兼容性：无破坏性变更

## 重点更新

### 1) 移动端交互稳定性

- 修复编辑器处于输入态时，长按误进入拖拽导致原生文本选择被打断的问题。
- 增强移动端长按直拖链路，支持更稳定的整行拖拽与块级源视觉反馈。
- 调整点击/轻触事件处理，移除不必要的 `preventDefault` 干预。

### 2) 文档末尾拖拽边界修复

- 修复目标落点无法稳定定位到最后一行的问题。
- 修复末行与倒数第二行在移入/移出场景下的空行异常（多一行/少一行）。
- 重构末尾插入与删除路径，统一 `BlockMover` 的文本变更规划算法，减少特殊分支。

### 3) 可配置性与视觉能力增强

- 新增设置：可自定义“长按进入多文本块选择模式”的触发时间（ms）。
- 新增拖拽源高亮能力，并支持与列表落点高亮分开开关。
- 统一拖拽高亮样式接口，降低 source/list target 两套实现差异。

### 4) 架构与工程质量

- 完成 editor 模块命名统一与历史重复代码清理。
- 完成 `core / infra / features` 分层重构，职责边界更清晰。
- 对齐 AutoReview 规则，修复 sentence case、deprecated API 与 lint 违规项。

## 完整 Commit 清单（按时间顺序）

| Commit | 类型 | 摘要 |
| --- | --- | --- |
| `c88491c` | fix | 移除 `EmbedHandleManager`，改用 RAF 刷新机制。 |
| `a7ebeb3` | feat/fix | 增强移动端长按直拖并补充设置测试。 |
| `d261e44` | feat | 新增拖拽源视觉样式并统一高亮体验。 |
| `7394d19` | fix | 修复移动端整行长按拖拽与块级源视觉。 |
| `314364b` | refactor | 统一拖拽高亮样式接口。 |
| `ffb7586` | feat | 增加源高亮/列表落点高亮独立开关。 |
| `4135408` | fix | 恢复水平分割线拖拽能力。 |
| `1cdf7e0` | fix | 收紧 handle 解析并恢复 `hr` 命中测试。 |
| `525937e` | fix | 稳定渲染行命中测试并简化 fallback。 |
| `e793e97` | style | 移除范围选择连接线过渡动画。 |
| `8b16e14` | refactor | 统一 editor 模块命名并去重。 |
| `3085917` | refactor | 重组为 `core/infra/features` 分层结构。 |
| `9227cf6` | fix | 移除 tap 场景 `preventDefault`。 |
| `40834a4` | fix | 优化 handle 定位。 |
| `ef249c9` | fix | 对齐 AutoReview lint 并清理规则问题。 |
| `2792730` | fix | 保留移动端输入态原生文本选择。 |
| `513515c` | fix | 修复 sentence case 与 deprecation 警告。 |
| `b55a778` | feat/fix | 稳定文档末尾拖拽行为并补充设置能力。 |
| `bc8f570` | refactor | 统一 `BlockMover` 插入规划。 |
| `f252af2` | chore | 发布 `1.2.3`。 |

## 验证结果

- `npm run lint:review` 通过
- `npm run typecheck` 通过
- `npm run test` 通过（23 文件，173 测试）
