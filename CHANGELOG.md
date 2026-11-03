# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 SemVer。

## [Unreleased]

### Added

- M0/M1 插件骨架与“写—判—改”MVP。

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
