## ADDED Requirements

### Requirement: 业务统计时间窗口固定
系统 SHALL 只将 `transactionTime >= 2025-12-30 00:00:00` 的记录纳入业务统计范围。

#### Scenario: 过滤截止时间之前的数据
- **WHEN** 交易时间早于 `2025-12-30 00:00:00`
- **THEN** 系统必须将该记录排除在业务分类与业务聚合之外

### Requirement: 主营关键词分类（不区分大小写）
系统 SHALL 按关键词规则识别主营交易，并应用排除词优先级。

#### Scenario: 命中主营关键词
- **WHEN** 商品说明包含任一关键词：`codex`、`gemini`、`90刀`、`满血api`、`90d`（不区分大小写）
- **THEN** 系统必须将该记录标记为 `main_business`

#### Scenario: 命中排除关键词则不算主营
- **WHEN** 商品说明包含 `批量` 或 `批发`
- **THEN** 即使包含主营关键词，系统也必须不将该记录标记为 `main_business`

### Requirement: 闲鱼转账纳入主营范围
系统 SHALL 将 `商品说明 = 闲鱼转账` 的记录纳入主营统计范围（收入与支出都保留）。

#### Scenario: 闲鱼转账分类
- **WHEN** 商品说明严格等于 `闲鱼转账`
- **THEN** 系统必须将该记录标记为主营业务范围记录
- **THEN** 系统必须保留其原始方向（收入/支出）和状态用于统计

### Requirement: 流量消耗与平台抽成分类
系统 SHALL 按显式模式识别两类成本。

#### Scenario: 流量消耗分类
- **WHEN** 商品说明包含 `闲鱼超级擦亮充值`
- **THEN** 系统必须将该记录分类为 `traffic_cost`

#### Scenario: 平台抽成分类
- **WHEN** 商品说明包含 `分账-`
- **THEN** 系统必须将该记录分类为 `platform_commission`

### Requirement: 主营退款支出分类
系统 SHALL 仅将主营范围退款归集为 `business_refund_expense`，用于可分润净额扣减，不依赖订单关联。

#### Scenario: 识别主营退款
- **WHEN** 交易状态包含 `退款` 或商品说明包含 `退款`
- **AND** 去掉 `退款-` 前缀后的说明命中主营规则（主营关键词或 `闲鱼转账`）
- **THEN** 系统必须将该记录分类为 `business_refund_expense`

#### Scenario: 非主营退款不扣分润
- **WHEN** 交易状态包含 `退款` 或商品说明包含 `退款`
- **AND** 去掉 `退款-` 前缀后的说明不命中主营规则
- **THEN** 系统必须将该记录分类为 `other_refund`
- **THEN** 系统必须不将该记录计入可分润净额扣减

### Requirement: 内部互转识别与抵消
系统 SHALL 识别同订单号的一收一支镜像记录，标记为内部互转并在总统计中抵消。

#### Scenario: 识别同订单号一收一支
- **WHEN** 同一个 `orderId` 同时出现至少一条 `收入` 与一条 `支出`
- **THEN** 系统必须将该 `orderId` 下相关记录全部标记为 `internal_transfer`
- **THEN** 系统必须在最终业务总统计中排除这些记录
- **THEN** 系统必须在明细查询中保留这些记录用于对账审计

### Requirement: 分类优先级固定且可复现
系统 SHALL 使用固定优先级处理多规则命中，避免重复计数。

#### Scenario: 多规则同时命中时的优先级
- **WHEN** 单条记录同时满足多个分类条件
- **THEN** 系统必须按 `internal_transfer > traffic_cost/platform_commission > main_business` 的顺序归类
- **THEN** 系统必须保证单条记录在聚合统计中最多进入一个最终指标桶
