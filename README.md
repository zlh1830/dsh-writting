# 写作训练插件（dsh-train）

面向 DSH Web 的本地优先写作训练插件：题库导入、全幅答题、单次判分、评分卡与历史。

当前版本完成 M0 + M1（写 → 判 → 改 → 历史 MVP）。答题视图、Host 判分服务、storageDomain 持久化与可安装 bundle 均已落地；实时教练、对比视图、门槛兜底等属于后续轮次。

## 包结构

| 包 | 作用 |
|---|---|
| `packages/core` | 纯库：数据模型、评分合成、段落/句子锚点、JSON 宽松解析、建议守卫、Remote 契约 |
| `packages/questionbank` | Host：本地题库 Markdown、采分点抽取缓存、导入/列表/取题工具、`train` Remote |
| `packages/judge-cloud` | Host：单次 LLM 判分、服务端合分、`train_judge_attempt` 工具、`train.judge` Remote |
| `packages/writing` | Client：`conversation.view` “答题”tab、草稿/计时/字数、评分卡、锚点定位、历史 |
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
- `npm test` 使用离线夹具与 fake LLM，不访问网络。
- `npm run build` 会生成 `packages/writing/lib/client.js`；`lib/` 不提交。

## 安装到 DSH

`dsh plugin add link:<bundle>` 只链接 bundle 本身，不会自动安装兄弟包。把下面的 `<repo>` 替换为本地仓库目录后按顺序执行：

```powershell
npm run build

dsh plugin --profile web add zod@4.4.3 yaml@2.9.1
dsh plugin --profile web add `
  link:<repo>\packages\core `
  link:<repo>\packages\questionbank `
  link:<repo>\packages\judge-cloud `
  link:<repo>\packages\writing
dsh plugin --profile web add link:<repo>\packages\bundle

dsh --profile web --dump-config | Select-String 'train-'
```

安装后需要重启 Web profile（不是普通刷新）才会加载新的 Loader 行。

## 仓库与隐私边界

本项目按“代码公开、资料本地”的方式管理：

- `private/` 已被 `.gitignore` 排除，只存在于本地，存放：
  - `private/docs/specs/`：需求、技术、计划与最原始材料；
  - `private/docs/internal/`：内部 ADR、演示记录与执行清单；
  - `private/data/`：本地导出的题目、评分记录、草稿、日志等。
- `fixtures/` 下只放**合成场景**（虚构人名、地名、单位），不得放真实材料、个人信息或客户数据。
- 不提交 `$DSH_HOME` 下的数据、`.data/`、`private/`、`fixtures/private/`、`*.local.json`、`*.secret.*`、`.env*`。
- 仓库描述与 README 刻意使用“写作训练”这类宽泛表述，不写具体业务领域。

## 当前已知限制

- 实机验收已完成（2026-11-03，web profile）：三道合成题的导入、答题、判分、改稿涨分、历史回看与跨重启持久化均通过。
- 判分质量仍在校准：同一篇稿件在不同调用间的诊断可能出现 ±10 以上波动，评分卡会以“波动较大”标记；`thresholdState` 为 `calibrating`，校准留到 M4。
- 未做实时教练、链条卡、diff、门槛/兜底/参考版、弱点档案、提示卡、校准/导出。
- `conversation.view` 不能移除宿主 composer 的 AI 对话输入，物理锁对话留到后续轮次。

变更记录见 [CHANGELOG.md](CHANGELOG.md)。
