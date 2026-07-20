# SteadySpec 快速开始

SteadySpec 是反漂移方法的一个参考技能包。五个对外动词，每个都是一个带漂移门和责任路由的小闭环。安装前读 [SCOPE.md](SCOPE.md)。

## 安装

v0.6.1 **没有发布到 npm registry**。不要运行 registry 安装，也不要使用
`npx steadyspec`。只从官方 GitHub 仓库取得源码并固定到可信 tag 或
commit，然后验证、打包并安装本地 tarball：

```powershell
git clone https://github.com/BestBlade/SteadySpec.git
Set-Location SteadySpec
git checkout <trusted-tag-or-commit>
git remote get-url origin
git rev-parse HEAD

node --version  # 必须为 18 或更高
npm run validate
npm pack
npm install --global .\steadyspec-0.6.1.tgz
steadyspec --help
```

然后到你项目的目录下：

```powershell
Set-Location D:\path\to\project
steadyspec init --runtime codex --substrate docs --dry-run
steadyspec init --runtime codex --substrate docs
```

如果由 Agent 协助安装，它必须执行同一组可见命令，并报告 remote URL、
commit SHA、验证结果、tarball 名称和 `steadyspec --help` 结果。发现已有
SteadySpec 文件、runtime/substrate 冲突或需要 `--force` 时，必须停下来
交给人确认，不能把 Agent 辅助安装变成另一条不透明通道。

会自动检测你项目里的 `.claude/` 或 `.codex/`。传 `--runtime claude` 或 `--runtime codex` 手动指定。如果同时有 `openspec/` 和 `docs/changes/`，init 会问你哪个是正式介质（`--substrate openspec` 或 `--substrate docs` 可跳过提问）。docs 模式项目还会安装 `.steadyspec/substrates/docs/` 下的结构契约和模板。

## 可选的 v0.6 verify 闭环

闭环是长任务在 `verify` 阶段的可选支持，不是第六个治理动词。先用 manual 路由安装：

```bash
steadyspec init --runtime codex --substrate docs --closure manual
```

生成的 `.steadyspec/closure.json` 是待审模板，`proofPolicies` 默认为空，不能原样当成可执行证据。操作员必须用 executable + argv 数组、明确 cwd、超时、期望退出码、环境变量名、可变表面，以及 claim/coverage limit 配置获准的 proof；不得从变更文档或 Agent 输出推断 shell 命令。每个变更还要提供配置所引用的 `acceptance-profile.json`，封闭六个验收维度和精确候选路径。

准备状态前先验证配置、环境和至少一条正向 proof policy：

```bash
steadyspec closure --change <change-id-or-path> --validate-config --json
steadyspec closure --change <change-id-or-path> --dry-run-env --json
steadyspec closure --change <change-id-or-path> --calibrate <positive-policy-id> --json
steadyspec closure --change <change-id-or-path> --prepare --json
steadyspec closure --change <change-id-or-path> --status --json
```

正常顺序是新鲜 Critic -> 有界 Builder -> 配置的 proof policies -> 新鲜 Evaluator。支持命令只持久化并校验角色记录，不会替 Builder 修改实现文件。Evaluator 传输开始前，先创建同时绑定当前双指纹和预期运行目录的记录：

```json
{
  "schemaVersion": 1,
  "candidateFingerprint": "sha256:<current-candidate>",
  "evidenceBundleFingerprint": "sha256:<current-evidence-bundle>",
  "invocationId": "cycle-003-evaluator-1",
  "reviewer": "claude",
  "transport": "steadyspec-cross-review",
  "expectedRunDir": ".meta/changes/<change>/cross-agent/<new-run-dir>"
}
```

严格按以下顺序登记调用、启动这一次精确的外部运行并导入：

```bash
steadyspec closure --change <change> --import-critic <review-run-dir> --json
steadyspec closure --change <change> --builder-before <record.json> --json
steadyspec closure --change <change> --builder-complete <record.json> --json
steadyspec closure --change <change> --run-proofs --json
steadyspec closure --change <change> --evaluator-start <record.json> --json
# 仅按记录的 reviewer/transport 启动，并写入 expectedRunDir。
steadyspec closure --change <change> --import-evaluator <evaluate-run-dir> --json
```

判断下一步时看 JSON 的 `state` 和 `action`，不能只看退出码或自然语言：

| State | 含义 / 下一责任人 |
|-------|-------------------|
| `critic-required` | 运行绑定当前候选指纹的新鲜只读 Critic。 |
| `builder-required` / `builder-in-progress` | 只完成已声明、token 绑定的修复切片。 |
| `proofs-required` | 只运行操作员配置的 proof policies。 |
| `evaluator-required` | 先写入并导入匹配的 evaluator-start 记录，然后才能启动传输。 |
| `evaluator-running` | 只检查精确的 `expectedRunDir`，不得重复启动；导入该运行，或由人明确 reopen/abandon。 |
| `candidate-ready` | 进入普通的人类信任检查点；这是有界就绪，不是接受。 |
| `needs-user` | 范围、授权、证据或语义选择必须由人决定。 |
| `blocked-by-environment` | 修复传输或运行环境，不得改写缺失输出的含义。 |
| `non-convergent` | 检查复发、进度和限额，由人决定是否 reopen。 |
| `stale` | 候选或证据身份已经变化，按 action 重做对应阶段。 |

显式决策和恢复操作都需要理由，并保留 lineage：

```bash
steadyspec closure --change <change> --decide approve --reason "<批准已检查的不完整修复>" --json
steadyspec closure --change <change> --decide reject --reason "<拒绝已检查的不完整修复>" --json
steadyspec closure --change <change> --decide reopen --reason "<继续授权的理由>" --json
steadyspec closure --change <change> --decide abandon --reason "<停止工作的理由>" --json
steadyspec closure --change <change> --recover-previous --reason "<检查损坏主状态>" --json
steadyspec closure --change <change> --reset --reason "<开启新 lineage 的理由>" --json
```

`auto` 也只能处理配置允许的低风险切片。范围变化、需求缩减、公共/安全/数据等高风险语义、proof 策略变化、证据缺口、环境失败、无法收敛和残余未知仍归人。`candidate-ready` 不是接受、合并、归档、发布或真理。当前发布边界是 Windows 单用户；当前候选的全新 packed-install smoke 已通过，但它不替代精确远端 SHA 的 Windows/Linux CI、tag、GitHub Release 或人的发布决定。

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

## Cross-agent 审查通道（v0.5）

高不确定性设计或实现审查可以显式调用第二个本地 Agent。先从 manual
或 advisory 开始；`gated` 只是一条本地就绪声明检查，不是合并、归档或
发布权限。

```bash
steadyspec cross-review --change <change-id-or-path> --reviewer claude --mode design --run --pass-env ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL
steadyspec cross-review --change <change-id-or-path> --mode review --include-diff --advice --json
steadyspec cross-review --change <change-id-or-path> --mode review --include-diff --check-latest --json
```

切换 reviewer 时只显式传递所需的认证变量名；不要继承整个环境。真实
review 会消耗模型配额，并把 raw output、moderation 和 `run.json` 保存为
本地审计记录。packet-only 会内联有界 packet；敏感文件过滤只是降低披露，
不是 secret scanner。当前产品边界仍是 Windows 单用户；同家族或同项目
Agent 的结论只是辅助证据，不是独立真理，也不替人接受风险。完整参数、
校准、gated 和实验性 debate/POSIX 边界见英文
[QUICKSTART.md](../QUICKSTART.md#cross-agent-review-lane-v05)。

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

**本地安装的全局包**（一条命令；不会访问 registry）：

```powershell
npm uninstall -g steadyspec
```

**项目残留**（手动清理，每个跑过 `steadyspec init` 的项目里）：

```powershell
# 先确认当前目录确实是目标项目根目录，并列出精确目标。
Get-ChildItem -LiteralPath .claude\skills -Filter 'steadyspec-*' -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath .claude\workflows -Filter 'steadyspec-*' -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath .codex\skills -Filter 'steadyspec-*' -ErrorAction SilentlyContinue
Get-Item -LiteralPath .claude\commands\steadyspec -ErrorAction SilentlyContinue
Get-Item -LiteralPath .steadyspec -ErrorAction SilentlyContinue

# 只删除已经核对过的 SteadySpec 自有路径。
Remove-Item -LiteralPath .claude\commands\steadyspec -Recurse -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .steadyspec -Recurse -ErrorAction SilentlyContinue

# 对上面列出的 steadyspec-* skill/workflow 目录，逐个使用精确
# -LiteralPath 删除。然后打开 CLAUDE.md 和/或 AGENTS.md，只删除
# <!-- steadyspec --> 与 <!-- /steadyspec --> 之间的块。
```

**别删**你自己的东西：`openspec/`（如果你用 OpenSpec）、`docs/changes/<NNN>-*` 目录（你的变更记录）、CLAUDE.md 里 SteadySpec 标记块以外的内容。

## 接着读

- [SCOPE.md](SCOPE.md) —— Agent 级别矩阵、单开发者假设、SteadySpec 不承诺什么。
- [METHOD.md](METHOD.md) —— 可移植的反漂移方法。五个动词只是一个实现；方法不止于此。
- [README.md](README.md) —— 完整产品概览、跟 OpenSpec 怎么共存、稳定性边界。
