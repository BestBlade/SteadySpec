# 证据

SteadySpec 是拿这套方法用在自己身上建出来的。这是压缩记录。完整的自治理轨迹在 `.meta/` 里（git 忽略，仅本地）。

## v0.2-honest-tuning（失败了）

第一次尝试 v0.2，计划把全部 13 个 SKILL 重构成带内联触发器的五段式格式。三个原因让它失败了：

1. **没有设计草图就开始改。** 十三个文件在 vibe coding 模式下被重写。用户不知道什么东西变了。
2. **独特价值还没说清就开始设计表面。** 花了几个小时在 slash command 的格式上，却从来没先回答：SteadySpec 做了什么 OpenSpec 没做的事？
3. **校验器跟重写是同一个 Agent 在同一轮对话里写的。** 校验器通过，是因为引入违规的那个 Agent 也写了检查。

用户回退了所有内容。七条教训被提取出来，归档。这一轮取消——零代码交付。

## v0.2-alpha（交付了）

第二次尝试跑了 SteadySpec 自己的 Level 3 治理：

- **上下文考古**从现有的 13 个 SKILL 和 honest-tuning 归档里提取了 13 条约束和 12 个开放问题
- **质询**产出了全部 12 个架构问题的用户答案（编排放哪、跨运行时要不要对称、文档同步算法、治理重评估的触发条件）
- **编排草图**设计了四个动词流（explore / propose / apply / archive）作为原语的闭环组合，附完整 ASCII 图和具体场景
- **小辩论**产出 7 个结论，包括：在承诺全部四个动词流之前先插一个狗粮 spike（Slice 3a）；init 必须在介质冲突时问用户；时间单独的治理重评估信号降为信息提示，不作为触发
- **Slice 3a 狗粮 spike**验证了 Tier-2 Agent（DeepSeek-V4-Pro）确实可以从动词流导航到原语——在这之前另外三个动词流还没构建。这让晚期失败的成本从 5 个切片降到了 1 个
- **外部审查**抓住了内部质询和辩论都漏掉的 5 个问题，包括漂移处理功能里的一个逻辑漏洞——而这个功能正是为了防御本产品存在的反模式而设计的
- **九个垂直切片**交付了四个动词流 SKILL、Claude slash command、Codex yaml 描述符、校验器规则和介质冲突逻辑——已有原语 SKILL 正文零改动

honest-tuning 和这次的关键区别：设计草图在前，任何编辑在后；质询在前，架构决策在后；狗粮验证在前，全面构建承诺在后；外部审查在前，宣布完成在后。

## v0.3-alpha（已落地）

v0.3 把产品中心从“补齐功能缺口”改成“注意力与责任模型”：

- 增加决策归属账本、风险路由、注意力报告
- 增加 `/steadyspec:verify` 信任检查点
- 增加交接快照、apply 重新切片事件、archive 持久真相门
- 更新 Claude/Codex 运行时入口和 Claude Workflow 脚本
- 更新校验器，使 v0.3 合同锚点和 verify surface 缺失时失败

这不是引入 ECC，也不是把 SteadySpec 变成 agent 工具箱。ECC 只作为先验参考；SteadySpec 继续负责治理、归属、证据和不漂白归档。

## v0.4-alpha（release candidate）

v0.4 补上了用户在 plain docs 项目里指出的介质缺口：没有 OpenSpec 时，SteadySpec 以前只拥有记录位置，不拥有记录结构。

- 增加 `.steadyspec/substrates/docs/` 下的原生 docs substrate contract
- 增加 `steadyspec check`，校验 docs 模式 proposal/apply/verify/archive 结构
- 增加 docs templates 和 docs 模式安装状态元数据
- 在 flows、Claude commands/workflows、Codex descriptors 和包校验器里暴露 docs-check phase 命令
- 增加最小化的可选能力通道：`direction-map.md`、可选 `evidence-contract.md`、selection findings 合并进 findings、以及条件性的 `Mainline Decision` section
- 增加 v0.4 校验锚点，防止 release docs、contract、scope、method 和 flow support 静默漂移

这不证明语义正确、不提供独立验证，也不声称 docs 模式等价 OpenSpec。它给 docs 模式项目一个结构校验器，并给高不确定工作一条有边界的方式，避免过早选择低上限主线，同时不把高风险决定交给 agent。

## v0.5（Windows 单用户边界内交付）

v0.5 增加了 packet 绑定的 cross-agent 传输、raw/moderation 分离、scope
freshness、advisory/gated policy 和显式 reviewer 环境。多轮外部审查确实
抓到了环境继承、超时、scope 完整性和上下文边界缺陷，并在 v0.5 源码
快照前修复。证据仍然只是单操作员 Windows dogfood，不是团队/POSIX 或
reviewer 判断质量证明。

## v0.6（已交付源码快照）

v0.6 用自己的闭环处理了自己的发布候选。本地证据跑过多轮 Critic ->
Builder -> proof -> Evaluator：每轮候选和证据分别计算指纹；Builder 先
声明路径、授权 finding、proof policy 和 completion token；proof 只运行
操作员配置的直接 executable/argv；新鲜 Evaluator 同时绑定候选与证据，
并保留原始 verdict、未知项、未观测现实和独立性限制。

dogfood 已经实际抓到并修复了四类状态机问题：历史 incomplete-repair 记录劫持后来状态、Critic 基线写入时机错误、旧状态缺少基线时伪造进度，以及 carried-forward finding 让 Builder 无法继续。它也保留了 `fix-required`、`blocked-by-environment` 和 `non-convergent` 的原始语义，没有为了收口把它们改写成 pass。当前 Claude 认证不可用，因此这部分只记录为环境限制；同家族 collaboration agent 的结果也只算结构化审查，不算独立真理。

v0.6 最终补上了本地 packed-install、状态中断/恢复和新鲜
Critic/Evaluator 证据，并由人授权收尾。但是随后一次干净环境的第三方
审阅发现了另一层产品缺口：registry 安装并不存在，Windows CRLF 和 8.3
路径别名可能让验证失败，公开文档已经漂移，也没有 CI 和可观察 suite。
这些问题没有从 v0.6 历史里被擦掉，而是进入 v0.6.1。

## v0.6.1（只通过源码分发的可靠性候选）

v0.6.1 不增加方法论功能。它诚实化 Git 源码分发，阻止误发布 npm，修复
CRLF/路径 portability，拆出可观察验证 suite，增加 Windows/Linux CI，
并在 [`release-evidence/v0.6.1/`](../release-evidence/v0.6.1/README.md)
公开脱敏且可复验的证据。

这里记录的是发布前候选快照。当前 tag、GitHub Release 和远端 CI 状态属于
外部证据，必须按精确远端 SHA 查询；这份历史快照本身不构成发布声明。

## v0.7.0（实验性 Assurance Protocol Candidate）

v0.7 在五动词规范生命周期下面增加模型与角色无关的 assurance protocol
candidate，作为可选的声明完整性支持。它增加了无依赖参考 reducer、严格
trace/result schema、静态黑盒 conformance case、负对照，以及旧 v0.6
closure state format 的有损且不合规投影。公开复验命令、候选身份、观察
结果和残余未知见
[`release-evidence/v0.7.0/`](../release-evidence/v0.7.0/README.md)。

第一个本地候选 commit `3c35b39` 通过了技术 Critic/Evaluator 循环和全部
本地验证，却被用户否决：它把规范的软件生命周期称为 legacy recipe，并让
支持协议看起来像继任产品。这是产品级漂移，不是普通文案错误。修正版增加
[PRODUCT.md](PRODUCT.md)，恢复生命周期、能力和注意力的关系，把 legacy
用语收窄到旧 state projection，把宿主 goal 声明收窄为逐 change 记录与
汇总策略信号，并加入确定性的连续性信号。中英文 v1 合同内容同时固定在
validator 代码和两份 manifest 中，协调重绑两份摘要的负向 fixture 仍会
失败。validator 能迫使未来合同变化显式修改代码或版本，但不能证明人已
批准，也不能保证那次显式协调修改一定正确。

完成那次修复后，用户补充了最初的产品缘起：真正长期存在的问题，是 Agent
承担的现实工作已经可能超过责任主体逐项重做或检查的能力，而外部权力与后果
仍留在人或组织一侧形成的委托鸿沟。这说明 Product Contract v1 虽然有效阻止
了五动词被降格，却仍把当前五动词架构绑定得过于接近产品目的。v2 在
`docs/product-contract-history/v1/` 保留 v1 精确内容，把目的和稳定原则放在
机制上层，同时继续把五动词作为当前受兼容保护的软件参考架构。

随后一轮结构化审查又发现，这个区分仍然只存在于产品文案：已安装 flow 仍接收
单一 intent 字符串，可能把可疑手段冻结成目的。接受的 P1 修复把委托边界加入
router/explore/propose/apply/verify 及其 Codex/Claude 表面，并把 docs contract
升级为 version 2。checker fixture 现在会拒绝缺字段、apply 时的 `needs-human`，
与 unresolved challenge 并存的 `ready`、格式错误的 authority ref，以及缺失的
docs 目标文件/标题。确定性 archive 也会在每种 substrate 上重复委托/trust
门，而不是只依赖 docs checker。这只证明声明过的结构门，不证明语义分类、
当事人身份或引用决策的充分性一定正确。

下一轮 Critic/Evaluator 又发现：归档仍可能信任 Agent 返回的 checkpoint，而且
旧 pending 事务可能从恢复入口绕过工作流新加的 gather 门。修复后，公开的
`steadyspec delegation-check` 会在 OpenSpec、docs、`.meta` 与 custom 路径上
直接回读 proposal、trust、授权目标与标题，并把授权工件字节纳入指纹；归档
prepare/commit/recovery 都绑定并复核该指纹。负例覆盖缺失目标/标题、路径穿越、
缺失或 blocked trust，以及没有新绑定的旧 pending。安装态 smoke 也直接执行
这个公开命令。它堵住的是已观察到的结构绕过，仍不认证谁写了授权记录，也不
证明那项决定在语义上正确。

后续精确候选审查又发现了写前检查绕过：显式 custom base 可以是指向内置
命名空间或仓库外部的 symlink/junction。纯词法工作流门会接受它，随后
`propose` 可能先写 context、grill 或 proposal，较晚的 realpath-aware
`delegation-check` 才拒绝该路径。修复增加公开只读命令
`steadyspec delegation-path-check`，在第一次 proposal 工件写入前运行，并把
“失败时零写入”规则贯穿 canonical primitive、governed path、router、flow 与
Codex/Claude 适配器。contract fixture 覆盖 base、nested、active-child 链接；
Windows 本地运行使用真实 junction，同一 fixture 在 POSIX 选择目录 symlink，
同时要求目标 proposal 字节前后不变。安装态 smoke 会执行 path 与 artifact
两种检查。这仍是同一 Agent 观察到的检查时刻路径证据，不是恶意宿主认证，
也不能阻止检查后的文件系统竞态；本次 capture 未观察 POSIX 实际执行。

这次澄清是用户授权的产品方向，不是有效性证据。
[`docs/experiments/whole-product-pilot.md`](../docs/experiments/whole-product-pilot.md)
只是尚未预注册的全产品实验设计候选，尚无运行或结果。

这是本地候选证据，不是因果实验结果。它不证明 SteadySpec 已降低漂移或
人工负担，也不授权 commit、tag、GitHub Release、npm 发布或采用声明。

## 证明了什么（以及没证明什么）

- 这套方法在单作者场景下，从零产出了一个能用的编排层
- 引入外部审查者之后，方法抓住了自己的盲区
- docs 模式 checker 能在 plain-docs change 被视为结构就绪前，拒绝委托字段
  缺失、未 ready 的 apply 和已知 archive truth 风险
- v0.7 protocol 的黑盒进程行为可复验，但它的现实效果仍是未回答的实验
- 这套方法还没在多人团队、并行变更或 issue-tracker 介质的项目中验证过

参考技能包做了什么、不承诺什么，见 [SCOPE.md](SCOPE.md)。
