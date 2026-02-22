# Dragger 1.2.4 Release Notes

发布日期：2026-02-22（补充修订：2026-02-22）

## 发布信息

- 版本号：`1.2.4`
- 变更区间：`1.2.3..1.2.4`
- commit 数量：`5`（不含发布提交）
- 兼容性：无破坏性变更

## 重点更新

### 1) 跨文件拖拽能力正式上线

- 新增设置项 `enableCrossFileDrag`（默认关闭），可按需开启跨文件拖拽。
- 关闭时严格拦截跨文件 drop，开启后支持跨文件“移动语义”（目标插入 + 源删除）。
- 完成跨编辑器移动策略解耦，避免将复杂分支继续堆叠在主交互处理器中。

### 2) 同文件双窗口与移动端长按交互修复

- 修复同文件双窗口拖拽时“目标插入成功但源未删除”的重复块问题。
- 统一移动端长按拖拽入口为单阶段流程，移除长按触发两次选中的路径。
- 调整后行为：长按达到阈值后进入拖拽并高亮，松手完成移动后高亮自然清除。

### 3) 类型与文档结构可维护性提升

- 合并拖拽相关碎片类型文件，集中到 `src/shared/types/drag/`，统一导出入口。
- 补充并完善上一版本发布文档，确保历史变更与提交清单可追踪。

### 4) 设置与 CI 稳定性修复

- 设置项 `long-press duration` 改为毫秒数字输入（`300-2000ms`），替代滑动条，便于精确配置。
- 修复 `npm ci` 在 npm 9/10 环境下的锁文件不一致问题，补全 `vite-node` 依赖树中缺失的 `@types/node`/`undici-types` 锁定节点。

## 完整 Commit 清单（按时间顺序）

| Commit | 类型 | 摘要 |
| --- | --- | --- |
| [`bc02728`](https://github.com/Ariestar/obsidian-dragger/commit/bc02728) | docs(release) | 补充 `1.2.3` 发布说明与完整提交摘要。 |
| [`f55c335`](https://github.com/Ariestar/obsidian-dragger/commit/f55c335) | feat | 增加可配置跨文件拖拽并统一 drag 类型结构。 |
| [`192e5d5`](https://github.com/Ariestar/obsidian-dragger/commit/192e5d5) | fix | 统一移动端长按拖拽流程，修复重复选中问题。 |
| [`ca99f60`](https://github.com/Ariestar/obsidian-dragger/commit/ca99f60) | improve(settings) | `long-press duration` 改为毫秒数字输入。 |
| [`90b85a8`](https://github.com/Ariestar/obsidian-dragger/commit/90b85a8) | fix(ci) | 同步 `package-lock.json`，修复 `npm ci` 缺失 `undici-types` 报错。 |

## 验证结果

- `npx -y npm@10.9.2 ci` 通过
- `npm run lint:review` 通过
- `npm run typecheck` 通过
- `npm run test` 通过（24 文件，183 测试）
