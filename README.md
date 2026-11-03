# 写作训练插件（dsh-train）

> 仓库：<https://github.com/zlh1830/dsh-writting>（main 分支；里程碑 tag `v0.0.1-spike` / `v0.1.0-mvp` / `v0.2.0-coach`）

面向 DSH Web 的本地优先写作训练插件：题库导入、全幅答题、单次判分、评分卡与历史，以及可选的实时链条教练。

当前版本为 M2（`0.2.0`）：在 M1“写 → 判 → 改 → 历史”闭环上，增加链条卡、覆盖率教练面板、空位标记与本地模型可选路由。没有本地模型时，教练自动使用规则匹配；云端判分链路保持不变。

## 包结构

| 包 | 作用 |
|---|---|
| `packages/core` | 纯库：数据模型、评分合成、段落/句子锚点、JSON 宽松解析、链条/教练契约、建议守卫、Remote 契约 |
| `packages/questionbank` | Host：本地题库 Markdown、采分点抽取缓存、导入/列表/取题工具、`train` Remote |
| `packages/coach-local` | Host：链条卡加载、规则/本地模型识别、滞后确认、降级、`train` 教练 Remote |
| `packages/judge-cloud` | Host：单次 LLM 判分、服务端合分、`train_judge_attempt` 工具、`train.judge` Remote |
| `packages/writing` | Client：`conversation.view` “答题”tab、草稿/计时/字数、评分卡、教练面板、锚点定位、历史 |
| `packages/bundle` | `@local/dsh-train` bundle：patch + locale + icon |

## 开发命令

```powershell
npm install
npm run typecheck
npm test
npm run build
npm run verify
```

- 开发期使用 npm workspaces（`package-lock.json` 已提交）。
- `npm test` 使用离线夹具、fake LLM 与纯函数测试，不访问网络。
- `npm run build` 生成 `packages/writing/lib/client.js`；`lib/` 不提交。
- `npm run verify` 包含隐私检查、文档索引检查（有 `private/` 时）、类型、测试、构建与 client 检查。

## 安装到 DSH

`dsh plugin add link:<bundle>` 只链接 bundle 本身，不会自动安装兄弟包。把 `<repo>` 替换为本地仓库目录后按顺序执行：

```powershell
npm run build

dsh plugin --profile web add zod@4.4.3 yaml@2.9.1
dsh plugin --profile web add `
  link:<repo>\packages\core `
  link:<repo>\packages\coach-local `
  link:<repo>\packages\questionbank `
  link:<repo>\packages\judge-cloud `
  link:<repo>\packages\writing
dsh plugin --profile web add link:<repo>\packages\bundle

dsh --profile web --dump-config | Select-String 'train-'
```

安装后需要重启 Web profile（不是普通刷新）才会加载新的 Loader 行。

## 本地模型（可选）

实时教练默认 `mode: auto`：

- 未配置本地 provider：使用规则匹配（链条 anchor），面板标注“规则匹配 · 未配置本地模型”。
- 配置了 `train-local`（Ollama / llama.cpp / vLLM，OpenAI-compatible）时：优先本地模型；失败回退规则，连续失败降级，绝不回退云端。
- 设置页“写作训练”可查看 provider/model/mode/链卡数，并一键测试本地路由。

异机安装、模型配置、验收步骤与回滚见本地私有文档 `private/docs/internal/test/m2-transfer-test.md`（不随仓库发布）。

## 仓库与隐私边界

本项目按“代码公开、资料本地”的方式管理：

- `private/` 已被 `.gitignore` 排除，只存在于本地，存放：
  - `private/docs/INDEX.md`：私有文档总索引；
  - `private/docs/HANDOFF.md`：新会话交接单（只上传这一份即可起步）；
  - `private/docs/specs/`：需求、技术、计划与最原始材料；
  - `private/docs/internal/`：内部 ADR、计划、测试/验收、迁移手册、流程；
  - `private/data/`：本地导出的题目、评分记录、草稿、日志等。
- `fixtures/` 下只放合成场景，不得放真实材料、个人信息或客户数据。
- 不提交 `$DSH_HOME` 下的数据、`.data/`、`private/`、`fixtures/private/`、`*.local.json`、`*.secret.*`、`.env*`。
- 仓库描述与 README 刻意使用“写作训练”这类宽泛表述。

## 当前已知限制

- M1 已完成实机验收；M2 需要重启 web profile 后做规则模式实测，真模型在异机验证。
- 教练快照不持久化，重启后从全 missing 开始。
- 本地模型首 token 慢时，面板更新可能超过 3 秒目标；以实际记录为准。
- 未做 diff（M3）、门槛/兜底/参考版（M4）、弱点档案（M5）、提示卡/看板（M6）、校准/导出（M7）。

变更记录见 [CHANGELOG.md](CHANGELOG.md)。
