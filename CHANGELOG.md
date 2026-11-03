# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 SemVer。

## [Unreleased]

### Added

- M0/M1 插件骨架与“写—判—改”MVP。

### Fixed

- 修复 `link:` 安装后 host 插件在 DSH 启动时 `failed to import`：仓库补齐插件运行时导入的 `@deepseek-ai/*` devDependencies（`dsh-sandbox`、`dsh-storage`、`dsh-scope` 等 9 个，`0.2.1-rc.5`）。
- 修复 `storageDomain` 拒绝 domain 名 `dsh-train`（unit 名称只允许小写字母/数字/下划线）：改为 `dsh_train`，落盘目录 `storages/dsh_train/`。
- 修复“答题”tab 空白：Client 插件在 render 中读 `ctx.remote.train` 触发 Cordis `cannot get property "remote.train" without inject`，slot entry 崩溃。改为在 `$mount` 之后用嵌套 `ctx.inject(['slots','remote.train'], …)` 取得命名空间并注册视图（`remote.<ns>` 是 traced 子服务，读取方必须声明该服务名）。
- 修复答题视图在暗色主题下白底白字：改用 DSH 设计令牌 `--dsw-alias-*`（`label-primary`/`bg-layer-2`/`border-l2`/`state-*`），不再使用不存在的 `--dsh-panel` 等变量与 `color: inherit`。
- 修复判分 `model returned no text`：`deepseek-flash` 在 `maxOutputTokens=1200` 时把输出预算全部用于推理、没有留下正文；判分调用改为 `reasoningEffort: low`，上限提到 4096，超时 60s，并把 `finish/chunks/tokens` 写进空回复错误便于定位。
- 修复评分漂移（同一题 63 → 21）：五维改为**服务端派生**——coverage 取采分点矩阵命中率（命中 1/部分 0.5），chain/elements/language/material 由缺失环节、缺失材料点、格式问题与空话句数量扣分；模型不再输出维度分，避免 0–1 与 0–100 混用。
- 修复改稿被过度扣分：不再把上一轮 `{score, unresolved}` 原样发给模型（提示词从未解释该字段），不稳定检测仍保留在服务端。
- 修复判分 schema 过严：模型偶尔把 `formatIssues`/`missingLinks` 等写成对象，整张评分卡被判 `schema-invalid` 并触发第二次约 30s 的模型调用；改为 `textOf`/`textList` 归一化（对象取 `text/message/issue/...`），一条坏条目不再废掉整次判分。
- 修复草稿不保存：保存定时器把 `elapsedMs` 列入依赖，计时器每秒更新都会重置 2s 防抖，导致草稿永远不落盘；改为内容变更即时保存、每 2s 刷新计时状态、卸载/`pagehide`/`visibilitychange` 时冲刷。
- 修复“未修改重复提交也新增 Attempt”：提交前用 `contentHash` 与最近一次同会话提交比较，一致则直接展示上次评分（无评分时补判）并提示“未新增提交”，不再刷掉历史。
- 历史 Attempt 列表改为可滚动，服务端最多返回最近 20 条（原 5 条）。

## [0.1.0-mvp] - 2026-11-03

### Added

- `@local/dsh-train` bundle 与 `cordis.patch.yml`：题库、判分、答题视图三条 Loader 行。
- `@local/dsh-train-core`：zod 数据模型、评分合成、段落/句子锚点、JSON 宽松解析、建议守卫、`TRAIN_REMOTE` 贡献项。
- `@local/dsh-train-questionbank`：`$DSH_HOME/train/questions` Markdown 题库、采分点抽取与缓存、`train_question_import/list/get` 工具、`train` namespace 的列表/取题/保存 Attempt/历史方法。
- `@local/dsh-train-judge-cloud`：单次 `ctx.llm.stream` 判分、服务端合分、最多一次解析重试、同稿 60 秒幂等、`train_judge_attempt` 工具与 `train.judge` Remote。
- `@local/dsh-train-writing`：`conversation.view` “答题”tab、题目卡、字数/计时/暂停、草稿自动保存、提交、评分卡、锚点定位、历史 Attempt。
- 3 道合成题夹具、判分金标夹具、35 个离线测试、CI 工作流。
- 本地私有的 ADR 与演示清单（不随仓库发布）。

### Changed

- 开发期包管理器从 pnpm 改为 npm workspaces：本机 pnpm 12 在链接阶段堆栈溢出，pnpm 11 的 junction 布局使 rolldown/tsdown 传递依赖无法被 Node ESM 解析。插件在 DSH profile 中仍用 `dsh plugin`（pnpm）安装。
- Attempt 正文存 storageDomain，而不是 session 事件：外部插件不能安全追加自定义 required session 事件。

### Known

- 尚未完成真实 DSH 实机视觉验收；需要重启 Web profile 后由用户确认“答题”tab 与评分卡。
- 未做 M2–M7：实时教练、链条卡、diff、门槛/兜底/参考版、弱点档案、提示卡、校准/导出。

## [0.0.1-spike] - 2026-11-03

### Added

- Monorepo 骨架、npm workspaces、TypeScript、tsdown、vitest、CI 骨架。
- bundle patch、客户端 view 注册、`train` Remote 贡献项、storageDomain 数据层。
- 内部 ADR（本地私有，不随仓库发布）。
