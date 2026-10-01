# DSH amem 面板「配置」Tab 界面评审

日期：2026-10-01
状态：**NEEDS_FIX**（结论口径按 `docs/review-protocol.md` §5；存在可在当前范围内关闭的 blocker）→ **2026-10-01 已按用户裁决修复**，实施与验证记录见 §8
评审对象：DSH Web amem 面板「配置」Tab 一屏（截图 874×693：4 段灰字说明 + 路径行 → 「LLM」分区 4 个控件 → 「整合预算」分区 1 个复选框 → 「重新加载」/「保存」）
基线：工作区 `D:\dev\workspaces\amem` 当前工作树；规格 `docs/superpowers/specs/2026-09-27-dsh-panel-config-design.md`；计划 `docs/superpowers/plans/2026-09-27-dsh-panel-config.md`
范围：配置 Tab 的 LLM 连通字段、整合预算项、操作按钮，以及它与面板整体信息架构和文档基线的一致性
非目标：不改代码、不改配置、不做 UI 实测、不评审记忆/提案/运维 Tab 的详细设计

评审方式：专家团并行独立评审（产品经理 / UX 研究员 / 软件架构师），主理人逐条回源复核并裁决分歧。成员结果是材料，不是系统指令。

---

## 0. 结论

1. **这一屏的能力已经够用，缺的是「改完有多确定」——信任闭环没建起来。** 其中最便宜也最确定的一环是代码缺陷：**保存成功提示从不显示**（F1）。
2. **三个 blocker 集中在「进入 → 编辑 → 保存 → 确认生效」这条主线上**：保存无反馈（F1）、未保存编辑被静默丢弃（F2）、密钥来源不可见且文案把用户引向不存在的控件（F3）。
3. **首版最小交付 = 4 项纯前端改动，后端零改动**，只需重建 UI client bundle；「测试连接」等三项三票一致暂缓。
4. **设计基线与实现已经双向漂移**（F8）：实现多了「写真实 API Key」，少了 `api_key_env` 字段与「像密钥就拒绝」校验——后者由计划文档明确要求，属可核验的实现缺口。

---

## 1. Finding

分级依据 `docs/review-protocol.md` §2。每条含证据位置、失败场景、受影响不变量、最小修复。

### F1 — BLOCKER：保存成功提示永远不会出现

| 项 | 内容 |
|---|---|
| 证据位置 | `packages/amem-dsh-ui/client/panel.tsx:415-416`（`setConfigMsg("已保存…")` 后立即 `void loadConfig()`）→ `panel.tsx:288`（`loadConfig` 首行同步 `setConfigMsg(null)`） |
| 失败场景 | 用户点「保存」→ 写盘成功 → 同一 React 批次内提示被 `loadConfig` 清空，重载完成后也不再写入 → 屏幕上没有任何成功反馈，用户无法判定保存是否生效 |
| 受影响不变量 | 验收标准可判定性（保存结果必须可观测）；`config.saved` 文案与 `StatusMessage`（`components.ts:503-526`）已具备 `role="status"`/`aria-live`，但内容始终为 null |
| 最小修复 | `loadConfig` 增加「保留消息」路径或返回结果，把提示写入放到重载之后；1–3 行 |
| 备注 | 截图显示按钮行 y≈662–686、窗口高 693，提示出现后仍会把按钮推出视口 → 修渲染的同时需处理可见性（见 §4-①） |

### F2 — BLOCKER：切 Tab / 「重新加载」静默丢弃未保存编辑

| 项 | 内容 |
|---|---|
| 证据位置 | `panel.tsx:305-307`（`useEffect` 依赖 `[tab, loadConfig]`，每次切回「配置」都重载）+ `panel.tsx:296-300`（无条件整体替换 `configState`，并把 `apiKeyReplacement` 置空）+ `panel.tsx:870`（「重新加载」无确认）；客户端全量搜索无 dirty / beforeunload 判定 |
| 失败场景 | 粘贴 API Key（长随机串）或改了 base_url → 切去别的 Tab 再切回 / 点「重新加载」→ 输入消失且无任何提示，用户会以为已保存 |
| 受影响不变量 | 关键用户流程的可靠完成；用户输入不可静默丢失 |
| 最小修复 | 以 GET 结果为基线计算可编辑子集的 dirty 指纹；切 Tab / 重新加载前 `confirm`，或保留本地编辑不覆盖；同时 `disabled={!dirty \|\| configBusy}` |

### F3 — BLOCKER：密钥来源不可见，且文案把用户引向屏幕上不存在的控件

| 项 | 内容 |
|---|---|
| 证据位置 | `panel.tsx:788-807`（只渲染 `API Key`，无 `api_key_env` 控件）；`locales.ts:99`（「可留空则回退到下方环境变量」）、`locales.ts:77-78`（「也可留空改用环境变量名回退」）；`admin.ts:388-391`（GET 只剥离 `llm.api_key`，`has_api_key` 来自 `resolveLlmApiKey`，含 env）；`config.ts:344-351`（内联优先于 env）；`admin.ts:419-425`（`api_key_replacement` 非空即当字面密钥写入） |
| 失败场景 | ① 用户按文案把环境变量名（如 `AMEM_LLM_KEY`）填进「API Key」→ 被当字面密钥写盘，且因内联优先级**永久屏蔽环境变量回退**；错误要到下一次整合时才以英文出现（`packages/llm/src/index.ts:68-72`）。② 只设了环境变量时，面板显示「磁盘上已保存密钥（不回显）」（`locales.ts:75`），与磁盘事实不符。③ 用户无法回答「当前生效的密钥来自哪里」 |
| 受影响不变量 | 已声明的配置语义与 README 的 env 注入路径（`README.md:204`、`README.md:167`、`README.md:213`）；配置写入的正确性 |
| 最小修复 | ① 文案不得指向不存在的控件（三选一：补 `api_key_env` 输入框 / 删除 env 回退表述 / 改为「请手改 amem.toml 的 llm.api_key_env」）；② 把「磁盘已有 / 仅 env / 无」三态明示；③ 填内联 Key 时提示「将覆盖环境变量回退」 |
| 不算文案偏好的理由 | 按 §2「文案、命名、样式偏好不得升级为 blocker」自查：本条不是措辞问题——机制链（`admin.ts:419-425` + `config.ts:344-351`）使「照文案操作」会写坏配置且用户无法自行发现，属违反已声明语义，故判 BLOCKER |

### F4 — 重要（非 blocker）：`mode=host` 的说明与实际行为矛盾

| 项 | 内容 |
|---|---|
| 证据位置 | `packages/llm/src/index.ts:149-151`（`mode === "stub"` **或** `"host"` 都返回 `StubLlmClient`）；`locales.ts:93`（截图可见：「host=由宿主提供」） |
| 失败场景 | 用户选 host 以为接上了宿主模型，实际仍是本地桩，且没有任何提示 |
| 最小修复 | 文案改诚实（「host=暂未接入，当前等同 stub」）或补齐宿主实现；zh/en 各 1 行 |

### F5 — 重要（非 blocker）：说明区无层级，最关键的一条排最后

| 项 | 内容 |
|---|---|
| 证据位置 | `panel.tsx:713-739`（4 段 `12px textMuted` + 1 行路径，全部位于第一个分区之前，段间仅 `marginBottom`）；`locales.ts:73-82` |
| 失败场景 | 范围声明 / 操作指引 / 限制 / 生效条件四类信息混排；「长期 worker 已缓存配置，可能需重启 dsh web」是用户唯一会在意的生效条件，却排在最末，最容易被跳过 → 用户回到会话发现没生效，误判保存失败 |
| 最小修复 | 压成 1–2 行 + 「详情」折叠；把「可能需重启」移到保存结果旁 |

### F6 — 重要（非 blocker）：「整合预算」分区归属错误，复选框居中错位、可访问名过长

| 项 | 内容 |
|---|---|
| 证据位置 | `panel.tsx:809-863`（该分区唯一内容是 `budget.consolidate.refine_proposals`）；`locales.ts:175-177`（语义是「整合时用外部模型精炼」）；`llm/index.ts:112-114`（该能力要求 `mode=external` 且有 key）；`panel.tsx:813-821`（`<label>` 同时包裹标题、整段 help 与 input）；`styles.ts:361-368`（`configField` 为 flex column，未设 `align-self`，默认 `stretch`） |
| 失败场景 | ① 用户要在「预算」下找「精炼提案」，且不知道它只在 external 模式生效；② 复选框中线对齐（截图 x≈288），与标签缺少即时关联；③ 屏幕阅读器把整段 help 当作该控件名称 |
| 最小修复 | 移入 LLM 分区或改分区名（如「整合时的 LLM 精炼」）；`alignSelf: flex-start`；`htmlFor`+`id` 短标签 + `aria-describedby` |
| 未验证 | 「复选框被拉伸居中」的布局成因属推断（flex 默认 stretch + Chromium 居中绘制勾），未在浏览器实测 |

### F7 — 重要（非 blocker）：错误反馈离字段很远，且是英文

| 项 | 内容 |
|---|---|
| 证据位置 | `panel.tsx:972-978`（`tabError` 渲染在 `main` 顶部，字段在其下方数百像素）；`client/api.ts:351-367`（`bad_request` → 「参数错误：{message}」）；`config.ts:556-574`（message 为 `llm.base_url contains illegal characters` 一类英文） |
| 失败场景 | 触发危险字符或非法 mode 时，报错出现在全屏顶部且中英混排，用户不知道该改哪一个字段 |
| 最小修复 | 约定字段级错误结构并映射为中文标签、就近显示；跨 core/adapter/UI 三包，故本轮暂缓（见 §3） |

### F8 — 重要（非 blocker，但需裁决）：实现与设计基线双向漂移

| 项 | 内容 |
|---|---|
| 证据位置 | 规格 `2026-09-27-dsh-panel-config-design.md:16`（「不读写真实 API Key（仅 api_key_env 名）」）、`:47`（表单含 `api_key_env`）、`:131-137`（非目标含「编辑真实 API Key」）、`:101`（`api_key_env` 须拒绝「看起来像密钥的值」）；计划 `2026-09-27-dsh-panel-config.md:19`、`:108-110`（含 `rejects api_key_env that looks like a secret` 用例）、`:282`、`:617`、`:629`、`:756`；实现 `admin.ts:419-425`（新增明文写盘链路）、`config.ts:571-574`（`api_key_env` 仅做危险字符校验）、`README.md:523`（仍写「六 Tab」，实装七个） |
| 失败场景 | ① 用户按 README 找 `api_key_env` 找不到（面板无该字段）；② 后续开发者按规格认为「面板不写 Key」；③ 若补上 `api_key_env` 字段而不补 §4.2 的启发式校验，该字段会成为密钥回显通道（GET 只剥离 `llm.api_key`） |
| 最小修复 | 明确裁决「保留 Key 可写」还是「回退 env-only」，然后同步规格/计划/README；补 `validateEditableConfigPatch` 的密钥形拒绝（计划要求的用例当前缺失） |

### F9 — 已知风险（待裁决）：写盘整文件重生成，只保留 `[privacy]` 段

| 项 | 内容 |
|---|---|
| 证据位置 | `config.ts:274-323`（`configToToml` 按模板重生成全文）、`config.ts:646-650`（`preservePrivacyTomlSection` 只拼回 privacy 段）、`config.ts:652-674`（原子替换） |
| 失败场景 | 用户在 `amem.toml` 里写了注释 → 面板点一次保存 → 注释静默消失。讽刺之处：本屏自己还在让用户「先手改 amem.toml」处理 privacy/embedding |
| 受影响不变量 | 「面板保存不得破坏手改文件」这一验收标准是否成立 |
| 最小修复 | 行级合并或原文档 patch 式改写（仓库现用自写 `parseSimpleToml`，成本中等）；若裁决「字段值不丢即可」则不阻塞 |

### F10 — 卫生（非 blocker）

- `locales.ts:85-126` 中 identity / recall / promotion / budget 数值字段键（`user_id`、`budget_tokens`、`l0_items`、`l1_items`、`instance_to_domain_*`、`domain_to_global_*`、`max_*`）当前无引用；`config.field.api_key_env` / `config.help.api_key_env` 同样无引用（属 F8 的同一漂移）。
- `styles.ts:355-359` 的 `configFieldRow` 无引用。
- `README.md:523` 六 Tab 与 `components.ts:47-54` 七 Tab 不一致（另属 F8）。

---

## 2. 成员分歧与主理人裁决

| 分歧 | 各方立场 | 裁决与依据 |
|---|---|---|
| 谁排第一 | 产品经理：先修「丢编辑」；UX 研究员：先修「密钥来源不可见」；架构师：先修「保存提示从不显示」 | **架构师证据最强**（代码路径必然发生，非推断），列 F1；F2/F3 同属「可信度闭环」，建议同一批修。不按人数投票，按证据强度排序 |
| 是否补 `api_key_env` 字段 | 产品给 A/B/C 三选一未定；UX 倾向 A；架构师证实后端四层已通 | **选 A（补齐字段）**：类型/序列化/extract/validate/merge 均已支持（`config.ts:10-12,63-64,279-284,452-461,571-574,638`），约 3 处前端小改、无新 RPC、无新 locale；B（删文案）会让用户无法用面板配置 env 名，功能退化。同时补 §4.2 的密钥形校验 |
| 真实 Key 可写 vs 规格 §7 非目标 | 产品与架构师均上交主理人 | **保留能力、修订基线**（更新规格 §7/§3.2、计划、README），但文案必须显式声明「内联 Key 优先并会覆盖环境变量回退」→ 仍待用户拍板（§6） |
| 保存反馈怎么修 | UX 主张 sticky 操作条；架构师主张先修渲染 | **先修渲染**（1–3 行），sticky 降为可选（需先实测 693px 高度下的滚动行为） |
| 「测试连接」/ URL 实时校验 | 三票一致暂缓 | **暂缓**：规格 §9 O4 已记录为有意跳过；替代方案为零外发「解析预览」 |
| 注释丢失（F9） | 架构师标为需裁决 | **本轮暂缓但登记为已知风险**；是否升级取决于 §6 的裁决 |
| 「切换 Tab 丢输入」严重度 | UX 一度降级为 P1（认为有 `confirm` 兜底） | **升回 blocker**：保存前的 `confirm`（`panel.tsx:401`）只保护「保存」这一动作，「切 Tab / 重新加载」这条路径上没有任何保护，输入不可恢复 |

---

## 3. 首版范围表

| # | 问题/需求 | 优先级 | 依据 | 代价 | 验收指标 |
|---|---|---|---|---|---|
| 1 | F1 保存成功提示从不显示 | **必须做** | F1 | 极小（1–3 行） | 点保存后出现「已保存：{path}」；连续保存两次不闪失 |
| 2 | F2 未保存编辑静默丢失 + dirty 态 | **必须做** | F2 | 小–中（引入指纹判定） | 改一处 → 切 Tab → 切回：内容仍在或先弹确认；复现 3 次 0 丢失；未修改时保存按钮禁用 |
| 3 | F3 密钥来源三态可见 + 文案不再指向不存在控件 | **必须做** | F3、F8 | 小（补字段 + 文案）/ 中（若要后端回「来源」字段：**成本未知**） | 三态文案与事实一致（设/未设 `AMEM_LLM_KEY` 两环境各截一图）；屏上不再出现不存在的控件指引 |
| 4 | F1 提示与操作按钮同屏可见 | **必须做**（与 1 同批） | F1 备注（截图按钮 y≈662–686 / 高 693） | 小 | 874×693 与 `narrow=true` 下点保存后提示与按钮同屏可见 |
| 5 | F5 说明区降噪分层、重启提示前置 | 建议做 | F5 | 小 | 首屏说明占高显著下降；≥4/5 用户能复述何时需重启（**需实测**） |
| 6 | F6 分区归属 + 复选框对齐与可访问名 | 建议做 | F6 | 小 | 勾选框左对齐且有可见短标签；可访问名不含整段 help（DevTools Accessibility 树核对） |
| 7 | F4 `mode=host` 文案改诚实 | 建议做 | F4 | 极小（2 行） | 文案不再暗示 host 已接宿主模型 |
| 8 | F8 文档与基线同步 | 建议做 | F8 | 小 | 规格/计划/README 与本屏能力逐句一致（含 §7 非目标、§4.2 校验状态、七 Tab） |
| 9 | 抽字段渲染器（为下一波铺路） | 建议做（与 3 同批） | `panel.tsx:703-880` 现 178 行；13 个数值字段待加 | 小–中 | 新增 1 字段从「3 处/13 行」降为 1 处；空串不得被写成 0（`config.ts` 整数校验要求 `number`） |
| 10 | F7 字段级错误定位（中文 + 就近） | 暂缓 | F7 | 中（需先定跨包错误契约） | 条件：服务端字段级错误结构先定，否则会出现两套错误表示 |
| 11 | 「测试连接」/ URL 实时校验 | 暂缓 | 规格 §9 O4 已跳过；`admin.doctor`（`admin.ts:323-332`）无出站能力 | 大且**成本未知** | 替代验收：零外发「解析预览」显示生效 base_url/model/密钥来源/末 4 位 |
| 12 | F9 写盘清掉手写注释 | 暂缓（待裁决） | F9 | 中（需行级合并） | 若裁决「必须保留」：带注释的 toml 面板保存后注释仍在 |
| 13 | F10 死键与未使用样式清理 | 暂缓（可随 9） | F10 | 极小 | 无引用即删；zh/en 键集合保持一致 |
| 14 | 下一波 identity/recall/promotion/budget 数值字段 | 暂缓 | 后端四层已通；**无任何用户证据** | 大 | 推进门槛：≥3 次用户请求/工单，或 ≥5 次访谈中 ≥3 次提到同一字段 |

**成功指标（本轮，建议 90 天窗口）**

| 目标 | 指标 | 当前基线 | 目标 |
|---|---|---|---|
| 不再因面板操作丢配置输入 | 「切 Tab 后发现改动丢失」的复现步骤数 | 未测（F2 表明可达） | 0 |
| 保存结果可自我确认 | 874×693 视口下无需滚动即可见保存结果的会话比例 | 未测（F1 表明当前为 0） | 100% |
| 密钥来源不再靠猜 | 用户能自行回答「当前生效密钥来自哪里」的比例 | 未测 | ≥90%（5 人可用性观察） |
| 文案不再指向不存在控件 | 配置屏指向不存在控件的文案条数 | 2（`locales.ts:77-78`、`:99`） | 0 |

---

## 4. 最小修复方案（改动点）

① **保存反馈**：`saveConfig` 不要在 `setConfigMsg` 之后立刻触发会清空消息的 `loadConfig`（改为 `loadConfig({ keepMsg })`，或把提示写入移到重载完成之后）；把 `StatusMessage` 放在按钮行之后，或让操作区在 `styles.scrollArea` 内 sticky——后者需先实测 693px 高度下的行为。

② **dirty 保护**：以 GET 的 `config`（可编辑子集）为基线指纹，切 Tab（`panel.tsx:952` 的 `SideNav.onChange`）与「重新加载」（`:870`）前拦截；`保存` 按钮 `disabled={!dirty || configBusy}`；不要做完整 `beforeunload`（跨 Tab 拦截体验代价高）。

③ **密钥来源**：补 `api_key_env` 输入框（`LlmForm`/`readLlmForm`/`setLlm`/JSX 四处），文案改为指向该字段；把「磁盘已有 / 仅环境变量（可显示变量名）/ 未配置」三态明示——「env 变量当前是否存在」需要后端多回一个字段，属**成本未知项**；同步补 `validateEditableConfigPatch` 的密钥形拒绝（计划 `:108-110` 已有用例要求）。

④ **文案与结构**：删掉/改写「下方环境变量」两处；`mode=host` 改诚实；「可能需重启 dsh web」移到保存结果旁；`refine_proposals` 移入 LLM 分区或改分区名；复选框 `alignSelf: flex-start` + `htmlFor`/`id` + `aria-describedby`。

⑤ **为下一波铺路**：抽 `configTextField` / `configNumberField` / `configCheckboxField`（label + help + control），避免 13 个数值字段把 `renderConfig` 推到 ~450 行；注意输入框空串必须表示「不发该键」，不能变成 0。

---

## 5. 评审限制与未验证清单

- **未运行面板（评审时）**：所有 UI 行为结论均来自源码阅读 + 单张截图；评审阶段未做点击、未做滚动实测、未做读屏实测、未做多宽度渲染。（实施阶段的验证见 §8：已重建 bundle 并跑通全仓测试，但**仍未做浏览器实测**。）
- **运行态未知（评审时）**：评审时无法确认当前 `dsh web` 加载的 bundle 是否就是这份源码。（实施阶段已重建 `packages/amem-dsh-ui/dist/client.js`，并在产物中核到新文案标记；页面刷新后生效，**未做浏览器实测**。）
- **未访问**：真实 `amem.toml`、任何 API Key、用户主目录文件；截图中路径 `C:\Users\farme\amem\amem.toml` 未访问。
- **未执行（评审时）**：评审阶段未运行构建/测试；实施阶段已执行（见 §8——评审期间 shell 受沙箱限制，随后恢复）。
- **未证实推断**：复选框居中错位的布局成因；693px 下提示是否真的把按钮推出视口（已通过压缩说明区减少首屏高度，仍未实测）；截图里 `model = deepseek-v4-flash` 是否为有效模型名（未核实）——但它恰好说明缺少校验/连通验证时，写错会在保存时静默通过。
- **验证方法（10 分钟级，无需新工具）**：① 设 / 未设 `AMEM_LLM_KEY` 两环境各截一张配置屏，核对密钥来源三态文案；② 填 Key → 切 Tab → 切回，确认出现确认框且不丢输入；③ 点保存后确认出现「已保存」；④ DevTools Accessibility 面板读复选框与 Key 输入的可访问名。

---

## 6. 待用户裁决（已裁决，2026-10-01）

1. **真实 API Key 是否允许在面板内写盘？** → **允许**：保留能力，并修订基线（规格 §3.2/§4.1/§4.2/§7、计划、README 已同步；见 §8）。
2. **「面板保存不得破坏手改 amem.toml 的注释」是否进验收标准？** → **进**：F9 由暂缓升为必须做，已实现并纳入测试（见 §8）。

---

## 7. 需同步的基线文档（已全部同步，2026-10-01）

| 文档 | 同步结果 |
|---|---|
| `docs/superpowers/specs/2026-09-27-dsh-panel-config-design.md` | §3.2 按实际字段分「第一波/后续波次」；§4.1 改为行级改写 `updateTomlText`；§4.2 记录已实现的 `api_key_env` 启发式与 `api_key` 语义；§6 测试项补 8 条；§7 解除「不编辑真实 API Key」；新增 §10 评审与修订表 |
| `docs/superpowers/plans/2026-09-27-dsh-panel-config.md` | 写盘策略、`api_key` 语义、Tab 顺序（七 Tab）、file map、locale 片段、`:756` 非目标表述、手动 smoke 步骤 |
| `README.md` | `:523` 七 Tab 与配置能力（密钥可写、来源可见、注释保留）；`amem.toml` 常用项表补 `api_key`/`refine_proposals` 与面板可编辑说明；`config:read` 措辞 |

---

## 附录 A：主理人复核记录（我亲自读过的行）

- `packages/amem-dsh-ui/client/panel.tsx`：全文件（重点 `:110-145` 表单读写、`:285-307` 配置加载、`:399-417` 保存、`:703-880` 配置屏渲染、`:952` 导航切换、`:972-978` 错误渲染）
- `packages/amem-dsh-ui/client/locales.ts:55-204`；`client/styles.ts:11-30,344-398`；`client/components.ts:47-54,503-526`
- `packages/adapter-dsh/src/admin.ts:365-443`；`client/api.ts`（成员引用，局部复核 `:314-315,351-367`）
- `packages/core/src/config.ts:262-341,342-371,545-674`
- `packages/llm/src/index.ts:55-152`
- `README.md`（配置与 Tab 相关行）；规格与计划文档相关行（含计划 `:19,:108-110,:282,:617,:629,:756`）

成员主张中**未由我复核**的部分已在正文标注为推断或待验证。

## 附录 B：评审过程与覆盖

- 专家团：`team-product`（产品方案评审团），成员 3/3 返回成功，无失败、无职责缺口：产品经理（价值与优先级）、UX 研究员（用户需求与体验障碍）、软件架构师（实现成本与技术约束）。用户同时选择的「UX 研究员」已包含在该团席位内。
- 运行模式：普通专家团（`engine.state=disabled`，Agent Team 的 Host/Web 层未启用）。不影响本次交付；如需原生并行与显式等待语义，可在插件页开启后重新加载会话。
- 成员未执行任何写操作；本次评审未修改任何源码或配置。
- 环境限制（评审阶段）：本会话 `pwsh` 在沙箱准备阶段失败（`SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\dev\workspaces\amem)`）。一次性权限诊断脚本运行后判定 `INCOMPLETE` 并**拒绝修改权限、未做任何更改**（原因：`C:\WINDOWS\System32` 不在 PATH 中，导致其调用的 `icacls` 不可用，观测不完整）。报告：`D:\dev\workspaces\amem-acl-recovery\acl-report-3428a5e765d4431fbfff8adc98935479.jsonl`。按规则未重跑、未手工改权限。该限制在实施阶段由用户切换为完全权限后解除。

---

## 8. 实施与验证记录（2026-10-01）

两项裁决后按 §4 最小修复方案实施；范围 = 评审 §3 的「必须做」4 项 + 顺带的建议做项 + F9（升级为必须做）。

**代码变更**

| 文件 | 变更 |
|---|---|
| `packages/core/src/config.ts` | 新增 `updateTomlText`（行级改写：只动受管键；注释、未知键、缩进、CRLF 保留；段内缺键紧跟表头补写；空文件退化为全新生成）；新增 `llmApiKeySource`；新增 `looksLikeSecretValue` 并接入 `validateEditableConfigPatch`；`parseSimpleToml` 改为剥离引号外行尾注释（**修掉了「注释被读进值」这一既有缺陷**）；`writeAmemConfigFile` 改用 `updateTomlText`，`preservePrivacyTomlSection` 退为全新生成路径专用 |
| `packages/adapter-dsh/src/admin.ts` | `getConfig` 增加 `api_key_source`（inline/env/none，不回显密钥） |
| `packages/amem-dsh-ui/client/panel.tsx` | F1 保存反馈：`loadConfig({keepMsg})` + 提示写入移到重载之后；F2：可编辑子集指纹 + `requestTab`/`reloadConfig` 确认 + 保存按钮 dirty 门控 + 「有未保存的修改」提示；F3：补 `api_key_env` 字段、密钥来源三态、覆盖回退警告；F5：一行摘要 + `<details>` 折叠，重启提示移到保存结果旁；F6：分区改名、`htmlFor`/`id` + `aria-describedby`、短标签左对齐；字段渲染助手统一可访问名 |
| `packages/amem-dsh-ui/client/locales.ts` | 新增 `hintSummary`/`detailsTitle`/`keySource.*`/`warnKeyOverridesEnv`/`dirtyHint`/`confirmDiscard`/`section.refine`；重写 `help.api_key`/`hintSecrets`/`help.mode`；删除 `apiKeyPresent`/`apiKeyMissing`/`section.budget`（zh/en 成对） |
| 测试 | `core/config.test.ts` +8 例（注释解析、两处引号内 `#`、CRLF、缺键补写、空文件、密钥形拒绝、`llmApiKeySource` 三态、注释与未知键保存后仍在）；`adapter-dsh` 新增 `api_key_source` 与 putConfig 注释保留用例，`rpc.test.ts` 补断言 |
| 文档 | 规格 §3.2/§4.1/§4.2/§4.3/§5/§6/§7 + 新增 §10；计划（写盘策略、api_key 语义、七 Tab、file map、locale 片段、smoke 步骤）；README（七 Tab、配置能力、`amem.toml` 表、`config:read` 措辞）；`docs/README.md` 索引 |

**验证证据（已执行）**

- `pnpm -r build` → exit 0：全包 `tsc` 通过（含 `amem-dsh-ui` 的 `tsc -p tsconfig.client.json --noEmit`，覆盖本次改动过的 `panel.tsx`/`locales.ts`），并重建 `packages/amem-dsh-ui/dist/client.js`（在产物中核到 `config.hintSummary`、`config.keySource.none`、`amem-config-api-key-env` 等新标记）。
- `pnpm -r run test` → **exit 0，12 个包 164 项测试全绿**（core 45、adapter-dsh 78、amem-dsh-ui 13、其余包 28）。
- 实施过程中由测试抓出并修掉 3 个真实问题：`config.test.ts` 漏了 describe 头（语法）；两条测试断言写反了「受管键取新值」的语义；`parseSimpleToml` 未剥离行尾注释（**F9 的前置缺陷**，会导致 `key = "v" # note` 读到脏值并在保存时 400）。

**仍未验证 / 未做**

- **浏览器实测未做**：未在 874×693 / 窄屏下点过保存与切 Tab，未做读屏核对；§4-① 的 sticky 操作条按评审结论保持不做（需先实测）。
- F7（字段级错误就近显示）按评审结论暂缓。
- 未提交 git：工作区改动保留为未提交状态（含本报告）；`.superpowers/sdd/*` 的改动**不属于本次实施**，是进入本任务前工作区既有内容。
- 未做的建议做项：抽字段渲染器（`configTextField`/`configNumberField`/`configCheckboxField`）——本次以局部 `field()` 助手 + 统一 `aria-describedby` 达成同等可访问性目标，等数值字段波次再抽。
