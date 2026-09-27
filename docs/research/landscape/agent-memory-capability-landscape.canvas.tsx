import {
  BarChart,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
} from "cursor/canvas";

const FOCUS = [
  {
    name: "OpenViking",
    org: "volcengine",
    stars: 38660,
    license: "AGPL-3.0",
    oneLiner: "Context Database：用文件系统统一 Memory / Knowledge / Skills",
    bet: "可浏览的 viking:// 虚拟文件系统 + L0/L1/L2 分层加载",
    strengths: [
      "Knowledge + Memory + Skills 同一抽象，可 ls/read/grep",
      "目录作用域检索，避免扁平向量池噪声",
      "会话可归档为可编辑 Markdown；多 Agent 原生集成",
      "LoCoMo / tau2-bench 有公开复现脚本",
    ],
    weaknesses: [
      "AGPL-3.0：闭源商业产品嵌入成本高",
      "重度依赖 Embedding + VLM，运维面大",
      "与火山生态绑定感强（也有多 provider）",
    ],
    fit: "要可审计、可编辑的「Agent 上下文库」，且能接受 AGPL 或走 SaaS/商业授权",
  },
  {
    name: "Ouroboros",
    org: "Q00",
    stars: 6095,
    license: "MIT",
    oneLiner: "Agent OS：面试门控 → 不可变 Seed → 评估 → 有预算的进化循环",
    bet: "失败点在输入清晰度，不在模型能力；规格优先于记忆检索",
    strengths: [
      "Socratic interview + 歧义分，锁意图再写代码",
      "3 段评估门（机械/语义/多模型共识）",
      "14+ coding runtime MCP；可回放、可观测",
      "MIT，插件层可把领域流程产品化",
    ],
    weaknesses: [
      "不是通用「用户记忆层」，而是 coding workflow OS",
      "学习曲线与仪式感重；小任务 overhead 大",
      "Stars 相对少，生态仍在早期",
    ],
    fit: "要把模糊业务需求变成可验证交付物；需要能力「结晶」与门控，而非聊天记忆",
  },
  {
    name: "MemOS",
    org: "MemTensor",
    stars: 11578,
    license: "Apache-2.0",
    oneLiner: "Memory OS：统一存取管，图结构可编辑，跨任务技能结晶",
    bet: "记忆是 OS 原语：L1 traces → L2 policies → L3 world model → Skills",
    strengths: [
      "统一 API + Multi-Cube 隔离/组合",
      "混合检索、异步调度、反馈纠错",
      "Local plugin（SQLite）与 Cloud 双路径",
      "强调跨任务 skill reuse / token 节省",
    ],
    weaknesses: [
      "完整自托管需 Neo4j + Qdrant，运维重",
      "产品面广，核心边界（memory vs skill OS）需自己划清",
      "云与开源能力不完全对等",
    ],
    fit: "企业级多租户记忆、多 Agent 共享/隔离、要 skill 演化与生产 SLA",
  },
  {
    name: "EverOS",
    org: "EverMind-AI",
    stars: 13189,
    license: "Apache-2.0",
    oneLiner: "Portable memory：Markdown 为真相源，local-first，跨应用随身带",
    bet: "可 Git diff 的 .md + SQLite + LanceDB，用户拥有数据",
    strengths: [
      "可读可改可版本化；文件编辑即写入",
      "用户轨迹与 Agent cases/skills 分轨",
      "轻依赖（无 Mongo/ES/Redis）",
      "Reflection / Knowledge Wiki / 技能抽取",
    ],
    weaknesses: [
      "语义检索/技能抽取需额外 embedding/rerank",
      "偏个人/小团队 portable，非大规模分布式",
      "能力面依赖配置分层（Tier 1 仅关键词）",
    ],
    fit: "个人或小团队要跨 CLI/App 携带记忆，且坚持 local-first、可审计源文件",
  },
] as const;

const PEERS = [
  {
    name: "Mem0",
    stars: 65989,
    license: "Apache-2.0",
    role: "Drop-in 事实记忆",
    when: "现有 Agent 栈只差 add/search 用户事实",
  },
  {
    name: "Graphiti (Zep)",
    stars: 31153,
    license: "Apache-2.0",
    role: "双时态知识图",
    when: "事实会过期，需要「当时为真」审计",
  },
  {
    name: "Cognee",
    stars: 30977,
    license: "Apache-2.0",
    role: "语料→图+向量管线",
    when: "文档库要一次 ingest 成可召回记忆",
  },
  {
    name: "Supermemory",
    stars: 30891,
    license: "MIT*",
    role: "托管记忆 + MCP",
    when: "要快接入；注意本地引擎闭源边界",
  },
  {
    name: "Letta",
    stars: 24878,
    license: "Apache-2.0",
    role: "有状态 Agent 运行时",
    when: "要整个带记忆层级的 Agent，而非纯存储",
  },
  {
    name: "LangMem",
    stars: 1684,
    license: "MIT",
    role: "LangGraph 记忆原语",
    when: "已在 LangChain/LangGraph 生态内",
  },
] as const;

export default function AgentMemoryCapabilityLandscape() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 1100 }}>
      <Stack gap={8}>
        <H1>Agent Memory / Capability 开源格局</H1>
        <Text tone="secondary">
          焦点四项目 + 同类对照。Stars 来自 GitHub API（2026-09-25）。方案对比（Opus vs GPT）在子代理完成后追加。
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        {FOCUS.map((p) => (
          <Stat
            key={p.name}
            label={p.name}
            value={`${(p.stars / 1000).toFixed(1)}k`}
            tone="info"
          />
        ))}
      </Grid>

      <H2>GitHub Stars（焦点四项目）</H2>
      <BarChart
        categories={FOCUS.map((p) => p.name)}
        series={[
          {
            name: "Stars",
            data: FOCUS.map((p) => p.stars),
          },
        ]}
        height={180}
      />
      <Text tone="tertiary" size="small">
        Source: api.github.com · 2026-09-25 · X: 项目 · Y: Stars
      </Text>

      <Callout tone="info">
        四者解决的不是同一问题：OpenViking = 可浏览上下文库；MemOS = 生产级记忆 OS；EverOS =
        Markdown 随身记忆层；Ouroboros = 规格门控 + 进化执行 OS（偏能力结晶，而非聊天记忆）。
      </Callout>

      <H2>焦点四项目对照</H2>
      <Table
        headers={["项目", "协议", "核心赌注", "最佳适用", "主要代价"]}
        rows={FOCUS.map((p) => [
          p.name,
          p.license,
          p.bet,
          p.fit,
          p.weaknesses[0],
        ])}
      />

      <H2>分项详解</H2>
      <Grid columns={2} gap={16}>
        {FOCUS.map((p) => (
          <Card key={p.name}>
            <CardHeader
              trailing={
                <Row gap={6}>
                  <Pill tone="neutral">{p.license}</Pill>
                  <Pill tone="info">{`${(p.stars / 1000).toFixed(1)}k ★`}</Pill>
                </Row>
              }
            >
              {p.name}
            </CardHeader>
            <CardBody>
              <Stack gap={10}>
                <Text weight="semibold">{p.oneLiner}</Text>
                <Text tone="secondary" size="small">
                  {p.bet}
                </Text>
                <Divider />
                <H3>优势</H3>
                {p.strengths.map((s) => (
                  <Text key={s} size="small">
                    · {s}
                  </Text>
                ))}
                <H3>劣势</H3>
                {p.weaknesses.map((w) => (
                  <Text key={w} size="small" tone="secondary">
                    · {w}
                  </Text>
                ))}
                <Callout tone="neutral">{p.fit}</Callout>
              </Stack>
            </CardBody>
          </Card>
        ))}
      </Grid>

      <H2>同类开源（建议一并纳入选型）</H2>
      <Table
        headers={["项目", "Stars", "协议", "角色", "何时选"]}
        rows={PEERS.map((p) => [
          p.name,
          String(p.stars),
          p.license,
          p.role,
          p.when,
        ])}
      />
      <Text tone="tertiary" size="small">
        Supermemory 的 MIT 主要覆盖客户端/MCP；本地引擎边界需单独核实。
      </Text>

      <H2>选型决策树（简版）</H2>
      <Stack gap={8}>
        <Text>
          1. 需要「当时为真」的事实审计 → Graphiti
        </Text>
        <Text>
          2. 只要给现有 Agent 加用户事实记忆 → Mem0
        </Text>
        <Text>
          3. 要 Memory+KB+Skills 可文件系统浏览/编辑 → OpenViking（注意 AGPL）
        </Text>
        <Text>
          4. 要企业多租户、图记忆、技能结晶与 SLA → MemOS
        </Text>
        <Text>
          5. 要跨应用随身、Markdown 可 Git → EverOS
        </Text>
        <Text>
          6. 要把模糊业务做成可验证、可进化的执行合同 → Ouroboros
        </Text>
        <Text>
          7. 要整套有状态 Agent 运行时（非纯存储）→ Letta
        </Text>
      </Stack>

      <Divider />
      <Text tone="secondary" size="small">
        与「业务能力提取」（Skills / Experience / Constraints / Knowledge /
        Processes）直接相关：OpenViking 与 MemOS/EverOS 偏资产存储与召回；Ouroboros
        偏规格门控与演化闭环。完整提取方案见 Claude Opus 5.5 与 GPT 5.6-sol 子代理产出后的对比。
      </Text>
      <Text tone="tertiary" size="small">
        Canvas 数据为研究快照，不构成生产选型承诺。
      </Text>
    </Stack>
  );
}
