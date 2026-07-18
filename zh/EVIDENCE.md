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

## v0.6（进行中的自狗粮验证）

v0.6 正在用自己的闭环处理自己的发布候选。当前本地证据已经跑过多轮真实的 Critic -> Builder -> proof -> Evaluator：每轮候选和证据分别计算指纹；Builder 必须先声明路径、授权 finding、proof policy 和 completion token；proof 只能运行操作员配置的直接 executable/argv；新鲜 Evaluator 同时绑定候选与证据，并保留原始 verdict、未知项、未观测现实和独立性限制。

dogfood 已经实际抓到并修复了四类状态机问题：历史 incomplete-repair 记录劫持后来状态、Critic 基线写入时机错误、旧状态缺少基线时伪造进度，以及 carried-forward finding 让 Builder 无法继续。它也保留了 `fix-required`、`blocked-by-environment` 和 `non-convergent` 的原始语义，没有为了收口把它们改写成 pass。当前 Claude 认证不可用，因此这部分只记录为环境限制；同家族 collaboration agent 的结果也只算结构化审查，不算独立真理。

这仍不是 v0.6 完成声明。待补证据包括：全新的 `npm pack` 安装 smoke；Builder、proof、Evaluator、decision、reset 和 terminal 状态的中断/恢复 fixture；BOM、CRLF、纯空白和二进制候选的精确字节陈旧性 fixture；自动回合与人类上浮次数的注意力指标；最后一轮新鲜 Critic/proof/Evaluator；以及由人负责的信任检查点。机器的 `candidate-ready` 只能作为那次审计的输入。

## 证明了什么（以及没证明什么）

- 这套方法在单作者场景下，从零产出了一个能用的编排层
- 引入外部审查者之后，方法抓住了自己的盲区
- docs 模式 checker 能在 plain-docs change 被视为结构就绪前，拒绝缺少结构和已知 archive truth 风险
- 这套方法还没在多人团队、并行变更或 issue-tracker 介质的项目中验证过

参考技能包做了什么、不承诺什么，见 [SCOPE.md](SCOPE.md)。
