# SteadySpec

### 与 Agent 长期协作，同时让责任保持可见

长时间跟 AI Agent 协作，有一个安静的失败模式：Agent 慢慢改了你的意图，
决策丢了归属，一个自洽但低上限的答案被过早选中，验证被当成真相，最终
记录被清理到不再描述实际发生过什么。SteadySpec 把以下内容组合起来：

1. 领域无关的[反漂移方法](METHOD.md)；
2. `explore -> propose -> apply -> verify -> archive` 五动词规范生命周期；
3. 注意力与责任路由，让人决定价值、风险和方向，而不必监督所有实现细节；
4. 能力机制，帮助强 Agent 超越不完美提问或临时领域知识缺口，展开并压力
   测试更好的方向。

这些部分的稳定关系写在[产品连续性合同](PRODUCT.md)里。宿主 Agent 的 goal
或 plan 能力可以串联多个 change。SteadySpec 保存每个 change 自身的记录并
汇总策略信号；它不定义 goal 到 change 的血缘或完成语义，也不拥有或认证
宿主 goal。

v0.7 增加了实验性的
[Assurance Protocol Candidate](../protocol/ASSURANCE_PROTOCOL.md)，作为
`verify`、交接和真实收口的可选声明完整性支持。它不会取代或降格五个治理
动词。

`ready-for-human` 是协议最强的声明：当前精确快照可以在已记录覆盖范围
内交给人做检查。它不是语义真理、人的接受、审查独立性，也不是合并、
归档、发布、部署或风险接受授权。

若要单独评估这层可选 assurance，不安装技能、不编辑 closure policy 也可以运行：

```bash
node bin/assurance.js reduce --trace protocol/examples/empty-trace.json --json
node bin/assurance.js reduce --trace protocol/examples/minimal-ready-trace.json --json
npm run validate:assurance
```

第一条会得到 `target-required`；第二条完整的合成 trace 会得到
`ready-for-human`，但它不是本仓库正确性的证据。suite 用 53 个静态黑盒
case 检查参考进程：51 个 model-independent core case，加两个显式 v0.6
projection extension case；并确认故意写坏的 always-ready 实现不能通过
core profile，同时拒绝缺字段或伪造 result fingerprint 的实现。它证明的是声明过的
协议行为，不证明真实项目里已经减少漂移或人工负担。

参考技能包（`/steadyspec:explore` / `:propose` / `:apply` / `:verify` / `:archive`）是 SteadySpec 规范的软件 change 生命周期：explore 把注意力路由到活跃风险，propose 记录决策归属账本和风险路由，apply 按垂直切片执行并把 proof 连接到决策，verify 在归档或交接前跑信任检查点，archive 跑产出-意图审查 + 文档同步 + confirmed_by + 持久真相门之后再写归档。它可以跟 OpenSpec、纯文档或 issue tracker 共存；领域无关的方法还能迁移到软件之外。

## v0.6 注意力保护型闭环

这是五动词生命周期中 `verify` 下面的可选支持。只有旧 v0.6 state format
在投影到 v0.7 时属于有损兼容表面；closure 产品和五个 flow 不是 legacy。

v0.6 在 `verify` 下面增加了一个可选的闭环支持引擎；SteadySpec 对外仍然只有五个治理动词。它把一次新鲜、只读的 Critic 审查，受约束的 Builder 修复，操作员配置的 proof，以及重新启动的新鲜 Evaluator 串成有界循环。候选、证据和角色输出都绑定指纹，目的是减少人在多轮机械验收和回调上的注意力消耗，而不是把机器结论升级成真理。

Evaluator 传输必须先登记、后启动：在 `evaluator-required` 状态写入同时绑定候选与证据指纹、`invocationId`、reviewer、transport 和 `expectedRunDir` 的记录，再执行 `--evaluator-start`，状态才进入 `evaluator-running`。此后只能导入这一次精确运行；不得重复启动。传输被中断时，由人检查记录并明确选择导入、`--decide reopen` 或 `--decide abandon`，Agent 不能自行重试并把它当成同一次验收。

`auto` 模式只能路由已声明、低风险且机械边界明确的修复。范围扩大、需求缩减、proof 策略变化、公共或高风险语义、环境失败、无法收敛、证据缺口和残余未知仍要交给人。`candidate-ready` 只表示当前候选、证据包、已声明上下文和未知项在这个边界内就绪；它不是人的接受、合并或发布授权，也不证明未观测现实中的正确性。

当前支持边界是 Windows 单用户。没有 Builder 操作系统沙箱、通用副作用或 proof 隔离、POSIX 就绪、团队工作流，也没有“多 Agent 共识即真理”的承诺。当前候选已通过本地全新 `npm pack`、隔离 global-prefix 安装和 CLI lifecycle smoke；这仍只是一个 Windows 主机上的候选证据，不代替精确发布 SHA 的远端 CI、tag、GitHub Release 或人的发布决定。

## v0.3 注意力与责任模型

v0.3 让责任显性化。重要决策会进入决策归属账本，按风险路由，并以注意力分层的方式报告：必须看的用户归属/高风险决策优先，需要瞥一眼的共享/中风险项其次，低风险 agent 自主决策可以折叠但仍可审计。模型细节见 [ARTIFACT_CONTRACT.md](../ARTIFACT_CONTRACT.md)。

## v0.4 文档合同与能力通道

v0.4 增加了两条有边界的能力。第一，docs 模式现在有 SteadySpec 自己的结构合同：`init` 会安装 docs contract 和模板，`steadyspec check` 会拒绝缺少锚点、证据字段不完整、信任检查点形状错误、以及把 fallback/debt 写成 proof 的归档。第二，高不确定度工作可以在原有五个动词内部使用可选的能力通道：记录方向分叉、压力测试主线选择、用 evidence contract 约束 claim 和 proof，并在归档里保留 promoted / parked / rejected 方向。

能力通道不是自治，也不是第六个动词。高风险方向、公共表面、数据、安全和主线决定仍然必须通过责任模型交给用户或至少进入 must-read。

## 快速开始

看 [QUICKSTART.md](QUICKSTART.md) 了解安装、五个动词和手动卸载清单。下面是方向性介绍。

v0.7.0 **没有发布到 npm registry**。不要运行 registry 安装，也不要使用
`npx steadyspec`；同名 registry 包不属于本项目支持的分发面。只从官方
GitHub 仓库取得源码，并固定到可信 tag 或 commit。

```powershell
git clone https://github.com/BestBlade/SteadySpec.git
Set-Location SteadySpec
git checkout <trusted-tag-or-commit>
git remote get-url origin
git rev-parse HEAD
npm run validate
npm pack
npm install --global .\steadyspec-0.7.0.tgz

Set-Location D:\path\to\my-project
steadyspec init --runtime codex --substrate docs --dry-run
steadyspec init --runtime codex --substrate docs
```

然后在你的 Agent（Claude Code 或 Codex）中：

```
/steadyspec:explore           # 项目状态报告（无主题）或主题探索
/steadyspec:propose <意图>    # 写一份提案，看情况跑 grill + debate
/steadyspec:apply <变更号>    # 按切片实现，带漂移检查
/steadyspec:verify <变更号>   # 在归档或交接前跑信任检查点
/steadyspec:archive <变更号>  # 关变更，过审查 + 文档同步 + confirmed_by + 持久真相门
```

不输命令的 vibe 模式也照常可用，SteadySpec 不打扰。

## 参考技能包的边界

参考技能包是 alpha。完整边界看 [SCOPE.md](SCOPE.md)。

- **Agent 能力：** 针对 **Tier 2** Agent 优化（DeepSeek-V4-Pro、Claude Sonnet 4.5+、GPT-4o 级别）。Tier 3 **不作承诺。**
- **单开发者：** 每个变更只有一名作者。"人"指的是**未来的你或接手者。**
- **你调用它：** SteadySpec 不会自动检测漂移。你怀疑有漂移的时候调它。
- **独立 Assurance 进程：** `assurance` 实现实验性协议候选；不安装、
  不调用五个软件动词也能单独评估。
- **生命周期辅助 CLI：** `init`、docs `check`、`cross-review`、
  `closure` 和 `hooks` 为五个治理动词提供支持，但不是新的方法论动词。
  没有顶层 `update`、项目级 `uninstall` 或通用 `status`。
- **issue-tracker 介质仍是实验性：** v0.4 增加了 docs 模式结构合同；GitHub issues / Jira / Linear 仍是外部记录。

## 目录结构

```text
steadyspec/
  METHOD.md             # 领域无关的反漂移方法
  PRODUCT.md            # 产品身份、五动词生命周期和变更权限
  EVIDENCE.md           # 吃自己狗粮的记录
  SCOPE.md              # Tier 矩阵、单开发者假设、不承诺清单
  QUICKSTART.md         # 五个动词 + 安装 + 手动卸载
  README.md             # 本文件
  CHANGELOG.md
  protocol/             # 实验协议、schema、conformance、示例与实验预注册
  .github/workflows/ci.yml  # Windows/Linux 源码验证
  zh/                   # 中文翻译
  recipes/
    software-sdd.md     # 方法 → 软件 SDD 的映射
    research-paper.md   # 非软件场景的迁移示例
  en/
    flows/              # 5 个动词流 SKILL
    primitives/         # 11 个原语 SKILL（精简，被动词流调用）
    router/             # 内部路由器
    adoption/           # 治理级别选择器
    runtime/
      claude/
        commands/steadyspec/   # 5 个薄指针 slash 命令
        workflows/             # 5 个确定性执行脚本
      codex/agents/            # Codex yaml 接口描述
  bin/
    init.js             # 有边界的 CLI 入口和辅助命令分发
    assurance.js        # v0.7 参考 reducer/fingerprint/projection 进程
    cross-review.js     # v0.5 cross-agent 审查运行器
    closure.js          # v0.6 收口状态机与证据绑定
    human-decision-transaction.js  # fail-closed 人类决策写入
    cross-review-hook.js  # 可选 cross-review hook 集成
    docs-check.js       # 确定性 docs substrate checker
    validate.js         # 内部包校验器
  tests/
    assurance-conformance.js  # 可替换实现的黑盒 conformance runner
    portability-fixtures.js  # CRLF、realpath、别名和逃逸回归
  release-evidence/
    v0.6.1/             # 公开候选证据与机器可读状态
    v0.7.0/             # 公开协议候选证据与残余未知
  schemas/              # closure/config/acceptance JSON schema
  manifest.json
  package.json
```

## 覆盖的漂移

五个动词流加上它们的原语，覆盖了这些漂移类型：

- **意图 → 实现漂移：** propose-flow + apply-flow 漂移检测 + archive-flow 产出-意图审查门
- **决策 → 记录漂移：** propose/apply 维护决策归属账本；verify/archive 检查责任归属和人属决策确认
- **上下文/历史漂移：** propose-flow 自动加载 context-archaeology；explore-flow 状态模式汇总历史信号
- **共识/架构漂移：** propose-flow 在方向分叉或边界不明确时自动跑 debate
- **文档/代码漂移：** archive-flow 文档同步自动扫描，带 `must-update` / `should-check` / `unlikely` 三级置信度
- **重复的局部漂移上升为战略信号：** archive-flow rollup 触发检查（最近 10 条归档中 ≥3 条提到相同模块/关键词）

## 与 OpenSpec 和其他技能包的共存

在 OpenSpec 项目中：

1. OpenSpec 拥有介质（提案文件、任务、规格书、归档结构）。
2. SteadySpec 拥有反漂移编排（五个动词流）。
3. SteadySpec 把变更记录写入 OpenSpec 的介质（`openspec/changes/<id>/`），遵循 OpenSpec 的写法。
4. 如果同时存在 `openspec/` 和 `docs/changes/`，init 会提示你选——或者传 `--substrate openspec` / `--substrate docs` 跳过。

SteadySpec 跟通用技能包（TDD、诊断、审查、效率工具）不冲突。那些技能可以产出证明信号或执行辅助；它们不替代 SteadySpec 的意图、审查和归档记录。

## 升级与卸载

SteadySpec 采用源码分发。升级时切换到新的可信 tag/commit，重新验证并
构建本地 tarball，再先运行 `init --force --dry-run` 检查覆盖范围。没有
顶层 `update` 或项目级 `uninstall`；卸载看 [QUICKSTART.md](QUICKSTART.md)。
本地安装的全局包仍可用 `npm uninstall -g steadyspec` 删除。

## 稳定性

v0.7.0 仍处于 1.0 之前。Assurance protocol、schema、conformance catalog
和参考进程都是明确的实验性表面；1.0 前可以通过新的 `protocolVersion`
发生不兼容变化，并必须记录在 [CHANGELOG.md](../CHANGELOG.md)。以下规范的
软件生命周期表面打算保持稳定；要改变它们，必须由人显式决定并升级
[PRODUCT.md](PRODUCT.md)：

- 对外动词名：`/steadyspec:explore`、`/steadyspec:propose`、`/steadyspec:apply`、`/steadyspec:verify`、`/steadyspec:archive`。
- 动词流 SKILL 名：`steadyspec-<verb>-flow`。
- 原语 SKILL 名：当前的 `steadyspec-*`。
- METHOD.md 结构：八个机制段落保持可定位；内容可以扩展。
- CLI 含义：`steadyspec init` 安装运行时技能、动词流、运行时适配器；选择 docs 模式时还会安装 docs contract/templates 并写项目状态。`steadyspec check` 校验 docs 模式 artifact 结构和已知 archive truth 风险。
- 状态结构：`.steadyspec/substrate.json` 用 `schemaVersion: 1`；在那个结构版本内字段只增不删。

## 方法优先

先读 [PRODUCT.md](PRODUCT.md) 了解产品身份和变更权限，再读 [METHOD.md](METHOD.md) 了解领域无关的反漂移机制。读 [recipes/software-sdd.md](../recipes/software-sdd.md) 看方法怎么映射成软件 SDD 动词和原语。读 [recipes/research-paper.md](../recipes/research-paper.md) 看一个紧凑的非软件迁移示例。

## 给人看的阅读路径

如果你在评估这套方法：

1. [PRODUCT.md](PRODUCT.md) —— 产品身份、五动词生命周期和变更权限
2. [METHOD.md](METHOD.md) —— 可移植的反漂移思想（8 条机制，领域无关）
3. [EVIDENCE.md](EVIDENCE.md) —— 吃自己狗粮的记录（方法用在自己身上发生了什么）
4. [SCOPE.md](SCOPE.md) —— 参考技能包适合你的项目吗？
5. [QUICKSTART.md](QUICKSTART.md) —— 日常使用长什么样

如果你在评估 Assurance Protocol Candidate：

1. [ASSURANCE_PROTOCOL.md](../protocol/ASSURANCE_PROTOCOL.md) —— 状态、绑定、转换与进程合同
2. [schemas](../protocol/schemas/) —— 严格 trace/result schema
3. [cases.jsonl](../protocol/conformance/cases.jsonl) —— 静态黑盒 case
4. [EXPERIMENT.md](../protocol/EXPERIMENT.md) —— 尚无结果的预注册价值实验
5. [v0.7.0 candidate evidence](../release-evidence/v0.7.0/README.md) —— 可复验结果与残余边界

如果你是一个接手了装有 SteadySpec 的项目的 Agent：

1. 已安装的 `steadyspec-adopt` SKILL —— 了解治理级别
2. 已安装的 `steadyspec-workflow` SKILL —— 知道下一步该跑哪个动词流
3. 五个 `steadyspec-<verb>-flow` SKILL，在你的运行时 `skills/` 目录里
