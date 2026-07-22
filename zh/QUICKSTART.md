# SteadySpec 快速开始

SteadySpec 在人类仍承担外部现实责任的条件下治理 Agent 委托。它帮助保留
已经授权的目的、质疑可疑手段、避免过早收敛到低上限方案，并让完成声明不
超过证据；它不创造或解除责任。

当前软件参考架构通过 `explore -> propose -> apply -> verify -> archive`
应用这一目的。采用前读[产品目的与连续性合同](PRODUCT.md)和
[SCOPE.md](SCOPE.md)。五个动词是当前规范手段，不是产品的最终目的。

## 从规范生命周期开始

按后面的源码安装步骤初始化项目，然后让一个 change 依次通过：

```text
/steadyspec:explore
/steadyspec:propose <意图>
/steadyspec:apply <change-id>
/steadyspec:verify <change-id>
/steadyspec:archive <change-id>
```

对于会产生现实后果的工作，`propose` 不会把 `<意图>` 当作一整块不可拆分的
授权声明，而会记录委托边界：

- **Authorized Outcome（授权结果）** 与 **Hard Constraints（硬约束）**：
  Agent 可以质疑，但除非已有委托明确覆盖变更，否则只能由授权的人/主体修改。
- **Challengeable Assumptions（可质疑假设）** 与 **Proposed Means（建议手段）**：
  Agent 应主动检验，而不是继承过时经验或低上限技术选择。
- **Delegated Decisions（已委托决策）** 与 **Challenge Resolution（质疑处理）**：
  记录 Agent 可以调整什么、重要分歧由谁决定、最后如何处理。

只有 `Delegation Status: ready` 才能进入 `apply`。缺少分类、`needs-human`
或仍有重要质疑未解决时，流程返回 explore/propose。它证明的是决策权如何分配，
不是证明人的选择或授权结果一定正确。

宿主 Agent 的 goal 或 plan 可以串联多个 change。SteadySpec 保存每个 change
自身的意图、证据和交接记录，并汇总策略信号；它不定义 goal 到 change 的
血缘或完成语义，也不拥有或认证宿主 goal。

## 可选的两分钟 Assurance 演示

实验性 v0.7 protocol 是高代价验证、交接或收口边界上的增量声明完整性支持。
它不是默认入口，也不取代五个动词。

在源码 checkout 中运行：

```bash
node bin/assurance.js reduce --trace protocol/examples/empty-trace.json --json
node bin/assurance.js reduce --trace protocol/examples/minimal-ready-trace.json --json
npm run validate:assurance
```

第一条输入合法，但状态是 `target-required`；退出码 0 表示 trace 合法，
不是 ready。第二条完整的合成 trace 会得到 `ready-for-human`，但它不是
本仓库正确性的证据。suite 运行 53 个静态黑盒 case：51 个
model-independent core case，加两个显式 v0.6 projection extension case；
并确认 always-ready 假实现不能通过 core profile，同时也会拒绝缺字段或
伪造 result fingerprint 的实现。这里不需要安装技能、初始化项目、编辑
closure 配置或登录 Agent。
真实 trace 结构见
[ASSURANCE_PROTOCOL.md](../protocol/ASSURANCE_PROTOCOL.md)。

要把另一个实现当作外部进程测试，可先看 runner 帮助，再逐项传入
executable 与 argv prefix：

```bash
node tests/assurance-conformance.js --help
node tests/assurance-conformance.js --implementation node --arg bin/assurance.js
```

自定义实现默认只跑 51-case `core` profile。若该进程也实现 SteadySpec 的
可选 v0.6 state projection，可显式加入两个 extension case：

```bash
node tests/assurance-conformance.js --implementation node --arg bin/assurance.js --include-v06-projection
```

下面两个负对照都应以非零退出：一个故意把所有 trace 都声称为 ready，
另一个删除必要结果字段或伪造 result fingerprint：

```bash
node tests/assurance-conformance.js --implementation node --arg tests/fixtures/assurance/always-ready.js
node tests/assurance-conformance.js --implementation node --arg tests/fixtures/assurance/incomplete-result.js
```

protocol/schema/conformance 在 1.0 前都是实验性表面，可能通过新的
`protocolVersion` 发生不兼容变化。

## 安装

v0.7.0 **没有发布到 npm registry**。不要运行 registry 安装，也不要使用
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
npm install --global .\steadyspec-0.7.0.tgz
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

这是 `verify` 下的可选进阶支持，不是首次使用的必经路径，也不是第六个治理
动词。只有旧 v0.6 state format 是供 v0.7 投影的 legacy 兼容表面。

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

`auto` 也只能处理配置允许的低风险切片。范围变化、需求缩减、公共/安全/数据等高风险语义、proof 策略变化、证据缺口、环境失败、无法收敛和残余未知仍归人。`candidate-ready` 不是接受、合并、归档、发布或真理。v0.6 closure 的运行边界仍是 Windows 单用户；当前 v0.7 候选的本地结果见 [公开候选证据](../release-evidence/v0.7.0/README.md)，它不替代精确远端 SHA 的 Windows/Linux CI、tag、GitHub Release 或人的发布决定。

## 五个动词

跑任意一个，本次会话就进入 spec 感知模式。Agent 会保持 SteadySpec 感知直到会话结束。

| 动词 | 什么时候用 | 示例 |
|------|-------------|---------|
| `/steadyspec:explore` | 问"项目什么状态、有什么债、接下来干什么"（无主题），或带着项目历史想一个问题（有主题） | `/steadyspec:explore` 看状态；`/steadyspec:explore "重构认证"` 做主题探索 |
| `/steadyspec:propose` | 把授权结果/硬约束与可质疑假设/建议手段分开，记录委托与证据，再硬化方向 | `/steadyspec:propose "统一会话超时"` |
| `/steadyspec:apply` | 先要求委托边界 ready，再按切片实现；漂移触及目的/约束时暂停并路由权力 | `/steadyspec:apply 099` |
| `/steadyspec:verify` | 在归档或交接前检查授权目的、委托/质疑处理、证据与风险 | `/steadyspec:verify 099` |
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

所有 substrate 都可以直接校验当前委托工件：

```bash
steadyspec delegation-check --change <repo-relative-change-path> --phase apply --json
steadyspec delegation-check --change <repo-relative-change-path> --phase verify --json
steadyspec delegation-check --change <repo-relative-change-path> --phase archive --json
```

`propose` 会在第一次写工件之前自动运行 `steadyspec delegation-path-check`。
显式 custom 路由中，只要 custom base 或 active child 存在 symlink/junction，
或者真实路径别名到内置命名空间，该预检就会阻止写入。把工作流适配到其他
宿主时，不要绕过这一步。

archive 校验要求 `Delegation Status: ready`、可解析的授权引用、五个 trust
gate 全部为 `pass`，并且 `Recommended Next: archive`。归档事务会把这组
工件指纹绑定到 prepare/commit/resume。它仍只是结构证据，不是语义真理或
人的最终验收。

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

`init` 后，`.claude/workflows/` 包含确定性执行脚本（`steadyspec-*.js`），与动词流逻辑一一对应。显式阶段门控和 schema 会约束输出结构，但不保证执行质量、语义正确或人的接受。当前包包含信任检查点脚本 `steadyspec-verify.js`。这些脚本通过 Claude Code 的 Workflow 工具调用，而非 slash 命令。

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

- [ASSURANCE_PROTOCOL.md](../protocol/ASSURANCE_PROTOCOL.md) —— 实验协议的规范状态与边界。
- [v0.7.0 候选证据](../release-evidence/v0.7.0/README.md) —— 可复验命令、结果和未覆盖项。
- [SCOPE.md](SCOPE.md) —— Agent 级别矩阵、单开发者假设、SteadySpec 不承诺什么。
- [PRODUCT.md](PRODUCT.md) —— 产品目的、稳定原则、当前软件参考生命周期和演进边界。
- [METHOD.md](METHOD.md) —— 可移植的反漂移方法。五个动词是规范的软件生命周期；领域无关方法还能迁移到软件之外。
- [README.md](README.md) —— 完整产品概览、跟 OpenSpec 怎么共存、稳定性边界。
