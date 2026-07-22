# SteadySpec 产品连续性合同

合同版本：1。状态：SteadySpec 0.x 系列的规范性产品身份边界。

这份紧凑合同用于防止一种更高层的漂移：一次技术上自洽的修改，仍可能重新
定义它本来应该改进的产品。每个 change 必须保留这里的稳定产品意图，或者
显式重新打开它。该合同不证明 SteadySpec 有效、不证明 Agent 确实遵守，也
不证明某个人已经批准修改。

## PI-1：面向长期工作，而不只面向最终声明

SteadySpec 处理长期工作中意图、上下文、决策、产出、证据、责任和持久记录
逐渐分离的问题。它覆盖从探索、执行到真实收口及跨 change 策略信号的治理
路径。对一个最终快照做 assurance 很有用，但不是整个产品问题。

## PI-2：五个规范的软件 change 动词

一个软件 change 的规范治理生命周期是：

```text
explore -> propose -> apply -> verify -> archive
```

primitives、checker、cross-agent review、closure engine、protocol 和 runtime
adapter 都用于支持这条生命周期。它们不是额外的治理动词，也不能取代或
降格这五个动词。

更长的目标可以使用宿主 Agent 的 goal、task 或 plan 能力串联多个 change。
SteadySpec 保存每个 change 自身的意图与证据记录、交接事实和既有决策，并
汇总跨 change 策略信号。它不定义 goal 到 change 的血缘或完成语义，也不
拥有、不认证、不保证宿主 goal 的状态。

## PI-3：人的注意力与最终责任

人保留价值、风险、方向、接受债务、验收、归档、合并和发布的责任。Agent
可以拥有有界、可逆的实现细节。SteadySpec 应把人的注意力集中到真正需要
决定的地方，而不是要求人检查每个机械步骤。

机器就绪、测试通过、同模型辩论、cross-agent 收敛和 protocol conformance
都是证据输入。它们都不是语义真理，也不转移人的最终责任。

## PI-4：不漂移地释放能力

SteadySpec 不只是刹车。上下文考古、grill、debate、方向图、证据合同和
cross-agent 审查帮助有能力的 Agent 避免过早选中一个自洽但低上限的答案。
当人无法给出完美提问、当前技术选项、实现专长，或临时参与跨领域工作时，
这项能力尤其重要。

这些机制扩大并压力测试可选答案，同时让高风险方向选择对人可见。它们不能
制造未提供的现实信息，也不保证专家级正确性。

## PI-5：Assurance 是增量式的声明完整性支持

review 和 proof 是生命周期中的质量机制。v0.6 closure engine 与实验性的
v0.7 assurance protocol 增加有界自动化，并约束系统对某个精确候选最多能
声称什么。closure 和 assurance 是按风险启用的可选支持，用于 `verify`、
交接、真实收口和归档就绪；它们不治理整个 change 生命周期，也不是五个
动词的继任者。

Assurance protocol conformance 比 SteadySpec 方法或产品 conformance 更窄。
旧 v0.6 closure state format 可以通过有损且不合规的兼容表面投影；这不代表
v0.6 closure 产品、五个 flow 或其 workflow contract 已成为 legacy。

## PI-6：产品身份变化由人决定

修改以下任一内容，都属于高风险、由人负责的产品决策：

- 产品所解决的问题或主要价值主张；
- 五个规范动词及其生命周期地位；
- 人与 Agent 的责任边界；
- 注意力路由或“不漂移地释放能力”的地位；
- 某个支持机制是否取代或降格治理生命周期；
- 既有的用户能力承诺或稳定公共表面。

Agent、外部审阅、benchmark、Critic、debate 或多 Agent 共识可以提出此类
修改，但不能批准。批准必须是显式的，并在修改被表述为产品方向前记录到
proposal、changelog 和发布证据中。

确定性验证会绑定合同版本、规范化后的精确内容、五动词列表和 assurance 的
增量支持地位，使变化可见。它不能认证人的身份，也不能证明批准是充分知情的。

## 演进边界

这份合同不冻结实现细节，也不声称五个动词在哲学上永远不变。它阻止普通或
自主 change 静默重定义它们。未来由人负责的战略决策可以升级合同版本，但
必须保留旧合同历史，明确哪些内容被删除或降格，并给出迁移及证据边界。
