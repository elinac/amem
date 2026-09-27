import {
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

const CONSENSUS = [
  "能力 ≠ Memory/RAG/Prompt：必须可寻址、可验证、可装配、可治理",
  "真相源 = Git 能力包；索引可重建；个人记忆与业务资产隔离",
  "自动抽取止于候选；生产晋升需门控 + 人工",
  "Agent Skills 作分发格式；Ouroboros 借门控演化；OpenViking 借分层检索",
  "高风险约束用确定性策略引擎，不靠模型自觉",
] as const;

const DIFFS = [
  {
    dim: "治理不变量",
    opus: "自动系统只能收紧/降级/熔断，不能新增或放宽约束",
    gpt: "自动化止于候选；高风险约束与正式发布必须人审",
    verdict: "采用 Opus 硬不变量（更可操作）",
  },
  {
    dim: "本体精细度",
    opus: "五类能力各自信任级别与演化权限表",
    gpt: "五类对象 + Capability Pack 目录模板更完整",
    verdict: "合并：Opus 权限表 + GPT 包结构",
  },
  {
    dim: "运行时装配",
    opus: "先确定性路由，再作用域语义检索；留 assembly manifest",
    gpt: "Context Pack + Token 预算百分比 + 固定优先级栈",
    verdict: "合并：Opus 路由序 + GPT Pack/预算",
  },
  {
    dim: "开源起点",
    opus: "EverOS/MemOS 做经验层；OpenViking 慎用 AGPL",
    gpt: "OpenViking 试点检索层；EverOS 个人/本地；MemOS 作 PoC",
    verdict: "小团队 EverOS；企业检索可试点 OV（法务过关后）",
  },
  {
    dim: "落地清单",
    opus: "12 项任务 + E1/E2/E3/SME 分工 + ADR",
    gpt: "7 天日程 + 阶段 0→3 周次计划",
    verdict: "用 Opus 分工表执行，用 GPT 阶段里程碑管理",
  },
] as const;

export default function CapabilitySchemeComparison() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 1100 }}>
      <Stack gap={8}>
        <H1>业务能力提取：Opus vs GPT 方案对比</H1>
        <Text tone="secondary">
          Claude Opus 5.5 与 GPT 5.6-sol 两套独立研究的共识、分歧与综合落地建议。
        </Text>
      </Stack>

      <Grid columns={3} gap={12}>
        <Stat label="共识条数" value="5" tone="success" />
        <Stat label="关键分歧" value="5" tone="info" />
        <Stat label="推荐姿态" value="合并" tone="warning" />
      </Grid>

      <Callout tone="success">
        两套方案高度同构：都把「业务能力」定义为可版本化软件资产，而不是向量记忆。综合方案取
        Opus 的治理硬不变量 + GPT 的 Capability Pack / Context Pack 工程封装。
      </Callout>

      <H2>高度共识</H2>
      <Stack gap={8}>
        {CONSENSUS.map((c, i) => (
          <Text key={c}>
            {i + 1}. {c}
          </Text>
        ))}
      </Stack>

      <H2>关键分歧与取舍</H2>
      <Table
        headers={["维度", "Opus 5.5", "GPT 5.6-sol", "综合取舍"]}
        rows={DIFFS.map((d) => [d.dim, d.opus, d.gpt, d.verdict])}
      />

      <H2>方案画像</H2>
      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader
            trailing={<Pill tone="info">Claude Opus 5.5</Pill>}
          >
            治理优先 / 可操作不变量
          </CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text size="small">
                强项：信任级别矩阵、「只收紧不放宽」、确定性路由优先、Policy
                在工具网关、12 项带角色的下周清单、EverOS 作经验层起点。
              </Text>
              <Text size="small" tone="secondary">
                弱项：Capability Pack / Context Pack API 封装不如 GPT
                完整；企业签名/注册表着墨较少。
              </Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="info">GPT 5.6-sol</Pill>}>
            工程封装 / 发布面完整
          </CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text size="small">
                强项：能力包目录模板、Context Pack、五级门控、SemVer/签名/灰度、阶段
                0–3 周次计划、HTTP API 面清晰。
              </Text>
              <Text size="small" tone="secondary">
                弱项：对「自动系统权限上界」表述稍软；信任级别按类型拆分不如
                Opus 尖锐。
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <H2>综合推荐架构（落地用这一套）</H2>
      <Stack gap={8}>
        <H3>1. 真相与隔离</H3>
        <Text>
          Git 能力仓为 SoT；Episode/轨迹不可变证据；派生混合索引可重建；个人记忆物理隔离。
        </Text>
        <H3>2. 能力包</H3>
        <Text>
          采用 GPT 目录：SKILL.md + capability.yaml + schemas + workflow +
          constraints(Rego) + evals + evidence；分发对齐 Agent Skills。
        </Text>
        <H3>3. 治理</H3>
        <Text>
          采用 Opus 不变量：自动只产候选与低信任经验；可熔断/降级；约束新增与放宽仅人工；结果标签用外部业务信号。
        </Text>
        <H3>4. 运行时</H3>
        <Text>
          Process 确定性选 Skill/Constraint → 作用域内检索 Knowledge/Experience →
          Context Pack（GPT 预算）→ Policy 网关强制拦截 → 写 assembly manifest。
        </Text>
        <H3>5. 开源拼装</H3>
        <Text>
          经验层：EverOS 或 MemOS local（外裹门控）；检索分层：借鉴 OpenViking
          L0/L1/L2；晋升循环：借鉴 Ouroboros；用户事实：Mem0；时态知识：按需
          Graphiti。
        </Text>
      </Stack>

      <Divider />
      <Row gap={8}>
        <Pill tone="neutral">Opus agent</Pill>
        <Text size="small" tone="secondary">
          28d9d1d9-d93a-475a-9673-3c9b3d2180e9
        </Text>
      </Row>
      <Row gap={8}>
        <Pill tone="neutral">GPT agent</Pill>
        <Text size="small" tone="secondary">
          906914c1-8958-409b-9963-93ead61deb40
        </Text>
      </Row>
    </Stack>
  );
}
