# SteadySpec

### 一门跟 Agent 协作的方法——以及证明它有效的证据

长时间跟 AI Agent 协作，有一个安静的失败模式：Agent 慢慢改了你的意图，决策丢了归属，验证被当成了真相，最终记录被清理到不再描述实际发生过什么。SteadySpec 是一套反漂移方法，命名了八条机制来阻止这件事。它是把这套方法用在自己身上建设出来的。

> **从这里开始：** [METHOD.md](METHOD.md) —— 可移植的思想（8 条机制，领域无关）。然后是 [EVIDENCE.md](EVIDENCE.md) —— 吃自己狗粮的记录（失败 + 成功，压缩版）。如果你想在真实项目里试试这套方法，这个仓库也附带了一个软件 SDD 参考技能包：四个编排原语的闭环动词流，内置漂移门。安装前先看 [SCOPE.md](SCOPE.md) 了解适用范围。

参考技能包（`/steadyspec:explore` / `:propose` / `:apply` / `:archive`）用闭环编排包裹了一套规格工作流：explore 自动加载项目历史，propose 跑 grill +（可选）debate，apply 按垂直切片走 TDD 规则并在检测到漂移时停下来，archive 跑产出-意图审查 + 文档同步自动扫描 + confirmed_by 门之后再写归档。它可以跟 OpenSpec、纯文档或 issue tracker 共存——方法是介质无关的，这个包只是一个实现。

## 快速开始

看 [QUICKSTART.md](QUICKSTART.md) 了解安装、四个动词和手动卸载清单。下面是方向性介绍。

```bash
npm install -g steadyspec
cd my-project
steadyspec init
```

然后在你的 Agent（Claude Code 或 Codex）中：

```
/steadyspec:explore           # 项目状态报告（无主题）或主题探索
/steadyspec:propose <意图>    # 写一份提案，看情况跑 grill + debate
/steadyspec:apply <变更号>    # 按切片实现，带漂移检查
/steadyspec:archive <变更号>  # 关变更，过审查 + 文档同步 + confirmed_by 门
```

不输命令的 vibe 模式也照常可用，SteadySpec 不打扰。

## 参考技能包的边界

参考技能包是 alpha。完整边界看 [SCOPE.md](SCOPE.md)。

- **Agent 能力：** 针对 **Tier 2** Agent 优化（DeepSeek-V4-Pro、Claude Sonnet 4.5+、GPT-4o 级别）。Tier 3 **不作承诺。**
- **单开发者：** 每个变更只有一名作者。"人"指的是**未来的你或接手者。**
- **你调用它：** SteadySpec 不会自动检测漂移。你怀疑有漂移的时候调它。
- **`init` 是唯一的 CLI：** 没有 `update`、没有 `uninstall`、没有 `check`。卸载靠手动 + `npm uninstall -g`。
- **暂不把 issue-tracker 当介质：** 推迟到 v0.3。

## 目录结构

```text
steadyspec/
  METHOD.md             # 领域无关的反漂移方法
  EVIDENCE.md           # 吃自己狗粮的记录
  SCOPE.md              # Tier 矩阵、单开发者假设、不承诺清单
  QUICKSTART.md         # 四个动词 + 安装 + 手动卸载
  README.md             # 本文件
  CHANGELOG.md
  zh/                   # 中文翻译
  recipes/
    software-sdd.md     # 方法 → 软件 SDD 的映射
    research-paper.md   # 非软件场景的迁移示例
  en/
    flows/              # 4 个动词流 SKILL（编排层，v0.2-alpha 新增）
    primitives/         # 11 个原语 SKILL（精简，被动词流调用）
    router/             # 内部路由器
    adoption/           # 治理级别选择器
    runtime/            # Claude/Codex 运行时适配
  bin/
    init.js             # v0.2-alpha 唯一的 CLI 命令
    validate.js         # 内部包校验器
  manifest.json
  package.json
```

## 覆盖的漂移

四个动词流加上它们的原语，覆盖了这些漂移类型：

- **意图 → 实现漂移：** propose-flow + apply-flow 漂移检测 + archive-flow 产出-意图审查门
- **决策 → 记录漂移：** apply-flow 每个切片记录证据；archive-flow confirmed_by 门用于人属决策
- **上下文/历史漂移：** propose-flow 自动加载 context-archaeology；explore-flow 状态模式汇总历史信号
- **共识/架构漂移：** propose-flow 在方向分叉或边界不明确时自动跑 debate
- **文档/代码漂移：** archive-flow 文档同步自动扫描，带 `must-update` / `should-check` / `unlikely` 三级置信度
- **重复的局部漂移上升为战略信号：** archive-flow rollup 触发检查（最近 10 条归档中 ≥3 条提到相同模块/关键词）

## 与 OpenSpec 和其他技能包的共存

在 OpenSpec 项目中：

1. OpenSpec 拥有介质（提案文件、任务、规格书、归档结构）。
2. SteadySpec 拥有反漂移编排（四个动词流）。
3. SteadySpec 把变更记录写入 OpenSpec 的介质（`openspec/changes/<id>/`），遵循 OpenSpec 的写法。
4. 如果同时存在 `openspec/` 和 `docs/changes/`，init 会提示你选——或者传 `--substrate openspec` / `--substrate docs` 跳过。

SteadySpec 跟通用技能包（TDD、诊断、审查、效率工具）不冲突。那些技能可以产出证明信号或执行辅助；它们不替代 SteadySpec 的意图、审查和归档记录。

## 升级与卸载

v0.2-alpha 只有 `init`。没有 `update` 或 `uninstall` 命令。升级或卸载看 [QUICKSTART.md](QUICKSTART.md)。全局包卸载：`npm uninstall -g steadyspec`。

## 稳定性

v0.2-alpha 是 alpha。1.0 之前仍可能有破坏性变更，但 SteadySpec 打算保持以下表面稳定，除非 [CHANGELOG.md](CHANGELOG.md) 明确说打破：

- 对外动词名：`/steadyspec:explore`、`/steadyspec:propose`、`/steadyspec:apply`、`/steadyspec:archive`。
- 动词流 SKILL 名：`steadyspec-<verb>-flow`。
- 原语 SKILL 名：当前的 `steadyspec-*`。
- METHOD.md 结构：八个机制段落保持可定位；内容可以扩展。
- CLI 含义：`steadyspec init` 安装运行时技能、动词流、运行时适配器，写项目状态。
- 状态结构：`.steadyspec/substrate.json` 用 `schemaVersion: 1`；在那个结构版本内字段只增不删。

## 方法优先

读 [METHOD.md](METHOD.md) 了解领域无关的反漂移机制。读 [recipes/software-sdd.md](recipes/software-sdd.md) 看方法怎么映射成软件 SDD 动词和原语。读 [recipes/research-paper.md](recipes/research-paper.md) 看一个紧凑的非软件迁移示例。

## 给人看的阅读路径

如果你在评估这套方法：

1. [METHOD.md](METHOD.md) —— 可移植的反漂移思想（8 条机制，领域无关）
2. [EVIDENCE.md](EVIDENCE.md) —— 吃自己狗粮的记录（方法用在自己身上发生了什么）
3. [SCOPE.md](SCOPE.md) —— 参考技能包适合你的项目吗？
4. [QUICKSTART.md](QUICKSTART.md) —— 日常使用长什么样

如果你是一个接手了装有 SteadySpec 的项目的 Agent：

1. 已安装的 `steadyspec-adopt` SKILL —— 了解治理级别
2. 已安装的 `steadyspec-workflow` SKILL —— 知道下一步该跑哪个动词流
3. 四个 `steadyspec-<verb>-flow` SKILL，在你的运行时 `skills/` 目录里
