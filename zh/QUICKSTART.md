# SteadySpec 快速开始

SteadySpec 是反漂移方法的一个参考技能包。四个对外动词，每个都是一个带漂移门的小闭环。安装前读 [SCOPE.md](SCOPE.md)。

## 安装

```bash
npm install -g steadyspec
```

然后到你项目的目录下：

```bash
steadyspec init
```

会自动检测你项目里的 `.claude/` 或 `.codex/`。传 `--runtime claude` 或 `--runtime codex` 手动指定。如果同时有 `openspec/` 和 `docs/changes/`，init 会问你哪个是正式介质（`--substrate openspec` 或 `--substrate docs` 可跳过提问）。

## 四个动词

跑任意一个，本次会话就进入 spec 感知模式。Agent 会保持 SteadySpec 感知直到会话结束。

| 动词 | 什么时候用 | 示例 |
|------|-------------|---------|
| `/steadyspec:explore` | 问"项目什么状态、有什么债、接下来干什么"（无主题），或带着项目历史想一个问题（有主题） | `/steadyspec:explore` 看状态；`/steadyspec:explore "重构认证"` 做主题探索 |
| `/steadyspec:propose` | 记录新工作的意图；自动跑 context-archaeology + grill +（可选）debate，收敛到验证过的方向 | `/steadyspec:propose "统一会话超时"` |
| `/steadyspec:apply` | 按切片实现已记录的变更；检测到漂移就停；给原地修补意图的选项 | `/steadyspec:apply 099` |
| `/steadyspec:archive` | 关一个变更；自动跑产出-意图审查 + 文档同步自动扫描 + confirmed_by 门 + rollup 触发检查 | `/steadyspec:archive 099` |

不输命令的 vibe 模式也照常——SteadySpec 不打扰。

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
rm -rf .codex/skills/steadyspec-*
rm -rf .steadyspec
# 然后打开 CLAUDE.md 和/或 AGENTS.md，删掉
# <!-- steadyspec --> 和 <!-- /steadyspec --> 之间的内容（如果有）
```

**别删**你自己的东西：`openspec/`（如果你用 OpenSpec）、`docs/changes/<NNN>-*` 目录（你的变更记录）、CLAUDE.md 里 SteadySpec 标记块以外的内容。

## 接着读

- [SCOPE.md](SCOPE.md) —— Agent 级别矩阵、单开发者假设、SteadySpec 不承诺什么。
- [METHOD.md](METHOD.md) —— 可移植的反漂移方法。四个动词只是一个实现；方法不止于此。
- [README.md](README.md) —— 完整产品概览、跟 OpenSpec 怎么共存、稳定性边界。
