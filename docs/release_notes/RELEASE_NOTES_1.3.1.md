# Dragger 1.3.1 Release Notes

2026-06-10

## 中文

### 发布信息

- 版本号：`1.3.1`
- 变更区间：`1.3.0..1.3.1`
- 兼容性：纯维护版本，无功能变更，建议所有 1.3.0 用户升级。

### 变更

#### 1) 修复 Obsidian 插件审核问题

- 移除已废弃的 `setDynamicTooltip` 调用。[[936022a](https://github.com/Ariestar/obsidian-dragger/commit/936022a)]
- 移除 `getFileByPath`（对 `minAppVersion` 1.1.0 来说不可用），改为只用 `getAbstractFileByPath`。[[5b431c6](https://github.com/Ariestar/obsidian-dragger/commit/5b431c6)]
- 移除 `styles.css` 中所有 `!important`（14 处）和 `:has()` 选择器（6 处），通过提高选择器特异性和 JS 动态添加 class 实现同等效果。[[5b431c6](https://github.com/Ariestar/obsidian-dragger/commit/5b431c6)]

#### 2) 修复 CI 与依赖

- 添加 `.npmrc` 开启 `legacy-peer-deps`，解决 `obsidian` 与 `@codemirror/view` 对 `@codemirror/state` 的 peer dependency 冲突。[[b75fdc5](https://github.com/Ariestar/obsidian-dragger/commit/b75fdc5)]
- 重新生成 `package-lock.json`，修复 `npm ci` 在 Node 24.x 下因 `undici-types` 版本缺失导致的失败。[[b75fdc5](https://github.com/Ariestar/obsidian-dragger/commit/b75fdc5)]

#### 3) 工程改进

- 新增 `.github/workflows/release.yml`，tag push 时自动创建 GitHub Release 并上传插件 assets，release note 自动读取 `docs/release_notes/`。[[4514532](https://github.com/Ariestar/obsidian-dragger/commit/4514532)]
- 将历史 release notes 统一迁移到 `docs/release_notes/`。[[4514532](https://github.com/Ariestar/obsidian-dragger/commit/4514532)]

## English

### Release Info

- Version: `1.3.1`
- Changes: `1.3.0..1.3.1`
- Compatibility: maintenance release only, no functional changes; all 1.3.0 users are recommended to upgrade.

### Changes

#### 1) Fix Obsidian Plugin Review Issues

- Removed deprecated `setDynamicTooltip` calls. [[936022a](https://github.com/Ariestar/obsidian-dragger/commit/936022a)]
- Removed `getFileByPath` (unavailable at `minAppVersion` 1.1.0), using only `getAbstractFileByPath`. [[5b431c6](https://github.com/Ariestar/obsidian-dragger/commit/5b431c6)]
- Removed all `!important` (14 occurrences) and `:has()` selectors (6 occurrences) from `styles.css`, replacing them with higher-specificity selectors and JS-added CSS classes. [[5b431c6](https://github.com/Ariestar/obsidian-dragger/commit/5b431c6)]

#### 2) Fix CI And Dependencies

- Added `.npmrc` with `legacy-peer-deps` to resolve the peer dependency conflict between `obsidian` and `@codemirror/view` on `@codemirror/state`. [[b75fdc5](https://github.com/Ariestar/obsidian-dragger/commit/b75fdc5)]
- Regenerated `package-lock.json` to fix `npm ci` failures on Node 24.x caused by a missing `undici-types` version. [[b75fdc5](https://github.com/Ariestar/obsidian-dragger/commit/b75fdc5)]

#### 3) Engineering Improvements

- Added `.github/workflows/release.yml` to automatically create GitHub Releases with plugin assets on tag push, reading release notes from `docs/release_notes/`. [[4514532](https://github.com/Ariestar/obsidian-dragger/commit/4514532)]
- Migrated historical release notes into `docs/release_notes/`. [[4514532](https://github.com/Ariestar/obsidian-dragger/commit/4514532)]
