# Dragger 1.2.7 Release Notes

发布日期：2026-05-26

## 发布信息

- 版本号：`1.2.7`
- 变更区间：`1.2.6..1.2.7`
- 兼容性：包含拖拽交互重构，建议升级前确认当前工作区已保存。

## 重点更新

### 1) Handle gutter 对齐与右侧布局修复

- 将拖拽 handle 改为 CodeMirror 原生 gutter marker 渲染，纵向布局交给 CodeMirror 管理。
- 右侧 handle gutter 不再依赖 `cm-gutters-after`，而是放到 `.cm-contentContainer` 末尾，与正文容器结构对称。
- handle gutter 改为零宽布局，放大 handle 时不再挤压正文文本。
- 修复软换行单行文本块中 handle 被居中到整块的问题：handle 现在模拟行号的 inline line-box 排版，和第一视觉行对齐。

### 2) Pointer-only 拖拽重构

- 移除原生 HTML5 drag/drop 路径，改为 pointer-based drag routing。
- 清理 native drag 时代的 ghost、DataTransfer、draggable 等兼容代码。
- 拖拽 session 生命周期收拢到 source registry，active drag source 成为唯一状态来源。

### 3) Handle 外观与设置优化

- 默认 handle 图标改为六点 grip。
- 默认 handle 尺寸增大，并扩大 handle size 设置范围。
- 六点 grip 单独放大核心显示比例，在同尺寸下更清晰。

## 验证结果

- `npm run typecheck` 通过
- `npm run lint` 通过
- `npm run test` 通过（35 文件，212 测试）
- `npm run build` 通过
