# SteadySpec 快速开始

SteadySpec 是反漂移方法的一个参考技能包。五个对外动词，每个都是一个带漂移门和责任路由的小闭环。安装前读 [SCOPE.md](SCOPE.md)。

## 安装

```bash
npm install -g steadyspec
```

然后到你项目的目录下：

```bash
steadyspec init
```

会自动检测你项目里的 `.claude/` 或 `.codex/`。传 `--runtime claude` 或 `--runtime codex` 手动指定。如果同时有 `openspec/` 和 `docs/changes/`，init 会问你哪个是正式介质（`--substrate openspec` 或 `--substrate docs` 可跳过提问）。docs 模式项目还会安装 `.steadyspec/substrates/docs/` 下的结构契约和模板。

## 五个动词

跑任意一个，本次会话就进入 spec 感知模式。Agent 会保持 SteadySpec 感知直到会话结束。

| 动词 | 什么时候用 | 示例 |
|------|-------------|---------|
| `/steadyspec:explore` | 问"项目什么状态、有什么债、接下来干什么"（无主题），或带着项目历史想一个问题（有主题） | `/steadyspec:explore` 看状态；`/steadyspec:explore "重构认证"` 做主题探索 |
| `/steadyspec:propose` | 记录新工作的意图；自动跑 context-archaeology + grill +（可选）debate，收敛到验证过的方向 | `/steadyspec:propose "统一会话超时"` |
| `/steadyspec:apply` | 按切片实现已记录的变更；检测到漂移就停；给原地修补意图的选项 | `/steadyspec:apply 099` |
| `/steadyspec:verify` | 在归档、交接或高风险继续前跑一次信任检查点 | `/steadyspec:verify 099` |
| `/steadyspec:archive` | 关一个变更；自动跑产出-意图审查 + 文档同步自动扫描 + confirmed_by 门 + 持久真相门 + rollup 触发检查 | `/steadyspec:archive 099` |

不输命令的 vibe 模式也照常——SteadySpec 不打扰。

## Docs 模式辅助校验

纯 docs 变更可以运行：

```bash
steadyspec check <change-id-or-path> --phase proposal --substrate docs
steadyspec check <change-id-or-path> --phase apply --substrate docs
steadyspec check <change-id-or-path> --phase verify --substrate docs
steadyspec check <change-id-or-path> --phase archive --substrate docs
```

`check` 校验 docs 模式所需的结构、证据字段、信任检查点字段，以及把 fallback/debt 写成 proof 这类 archive truth 风险。它是辅助命令，不是第六个治理动词，也不能替代 `/steadyspec:verify`。

## 可选能力通道

大多数变更不需要额外 artifact。当变更存在真实方向分叉、证据风险、主线风险、高影响产品或架构选择，或用户明确要求更强的解法搜索时，五个动词可以使用 v0.4 能力通道：

- `explore` 或 `propose` 可以创建可选的 `direction-map.md`。
- `propose` 可以加入 selection findings 和可选的 `evidence-contract.md`。
- `apply` 记录每个 slice 支持哪个 evidence-contract claim。
- `verify` 检查证据是否真的支持 mainline claim。
- `archive` 保留 promoted、parked、rejected 方向；默认路径重要时写 `Mainline Decision` section。

这个通道是可选的，不应该出现在日常清理、typo 修复或一次性工作上。

### Workflow 脚本（仅 Claude Code，v0.2.1+）

`init` 后，`.claude/workflows/` 包含确定性执行脚本（`steadyspec-*.js`），与动词流逻辑一一对应，通过显式阶段门控和 schema 验证输出保证了执行质量。当前包包含信任检查点脚本 `steadyspec-verify.js`。这些脚本通过 Claude Code 的 Workflow 工具调用，而非 slash 命令。

## 卸载

SteadySpec 不提供按项目的卸载命令——那可能删掉你的工作。卸载分两层：

**全局包**（一条命令）：

```bash
npm uninstall -g steadyspec
```

**项目残留**（手动清理，每个跑过 `steadyspec init` 的项目里）：

```bash
# 在项目根目录下，只删 SteadySpec 自己的东西
rm -rf .claude/skills/steadyspec-*
rm -rf .claude/commands/steadyspec
rm -rf .claude/workflows/steadyspec-*
rm -rf .codex/skills/steadyspec-*
rm -rf .steadyspec
# 然后打开 CLAUDE.md 和/或 AGENTS.md，删掉
# <!-- steadyspec --> 和 <!-- /steadyspec --> 之间的内容（如果有）
```

**别删**你自己的东西：`openspec/`（如果你用 OpenSpec）、`docs/changes/<NNN>-*` 目录（你的变更记录）、CLAUDE.md 里 SteadySpec 标记块以外的内容。

## 接着读

- [SCOPE.md](SCOPE.md) —— Agent 级别矩阵、单开发者假设、SteadySpec 不承诺什么。
- [METHOD.md](METHOD.md) —— 可移植的反漂移方法。五个动词只是一个实现；方法不止于此。
- [README.md](README.md) —— 完整产品概览、跟 OpenSpec 怎么共存、稳定性边界。
