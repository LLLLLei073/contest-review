import { z } from 'zod';
import { createAgent, tool, modelCallLimitMiddleware } from 'langchain';
import type { ToolRuntime } from '@langchain/core/tools';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { CoreStore, localDay } from './core-store.js';
import {
  AiReviewer,
  aiConfigSchema,
  aiReviewInputSchema,
  aiReviewRecordSchema,
  aiReviewNamespace,
  type AiConfig,
  type FetchLike,
} from './ai-review.js';
import { ASTRA_PERSONA, astraModel, astraComplete } from './astra-model.js';
import { LearningService } from './learning-service.js';
import { fingerprint, hintSchema, revisionSchema, transferSchema, type Citation } from './learning-domain.js';
import { dailyPlanSchema } from './training.js';
import { monthlyReport } from './monthly-report.js';
import { growthSummary } from './growth.js';
import {
  agentContextSchema,
  agentNamespace,
  agentRecordSchema,
  agentRunInputSchema,
  changeActions,
  type AgentContext,
  type AgentRecord,
  type AgentEvent,
} from './agent-domain.js';

const base = () => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString() });
type Run = Extract<AgentRecord, { kind: 'run' }>;
type Proposal = Extract<AgentRecord, { kind: 'proposal' }>;
const active = new WeakMap<
  CoreStore,
  Map<string, { controller: AbortController; sessionId: string; scope: string }>
>();
const decisions = new WeakMap<CoreStore, Set<string>>();
const suggestionLocks = new WeakMap<CoreStore, Set<string>>();
const json = (value: unknown) => {
  const text = JSON.stringify(value, (_, v) =>
    typeof v === 'string' && v.length > 12000
      ? v.slice(0, 12000) + '（已截断）'
      : Array.isArray(v) && v.length > 100
        ? v.slice(0, 100)
        : v,
  );
  return text.length > 48000 ? JSON.stringify({ summary: text.slice(0, 45000), truncated: true }) : text;
};

export class AgentService {
  constructor(
    readonly store: CoreStore,
    private fetchImpl?: FetchLike,
    private persist: () => Promise<void> = async () => {},
  ) {}
  namespace() {
    return agentNamespace(this.store.active(), this.store.activeAtcoder());
  }
  records() {
    return this.store.externalAll<AgentRecord>(this.namespace()).map((r) => agentRecordSchema.parse(r));
  }
  private save<T extends AgentRecord>(record: T, ns = this.namespace()): T {
    const parsed = agentRecordSchema.parse(record);
    this.store.externalPut(ns, parsed.id, parsed);
    return parsed as T;
  }
  settings() {
    return (
      this.records().find((r): r is Extract<AgentRecord, { kind: 'settings' }> => r.kind === 'settings') ?? {
        kind: 'settings' as const,
        id: 'settings' as const,
        memory: true,
        proactive: false,
      }
    );
  }
  private config(): AiConfig {
    const r = aiConfigSchema.safeParse(this.store.externalGet('ai', 'config'));
    if (!r.success) throw new Error('请先在设置中配置 AI 服务');
    return r.data;
  }
  private requireOwner() {
    if (!this.store.active() && !this.store.activeAtcoder()) throw new Error('请先绑定学习账号');
  }
  private session(id: string) {
    const s = this.records().find(
      (r): r is Extract<AgentRecord, { kind: 'session' }> => r.kind === 'session' && r.id === id,
    );
    if (!s) throw new Error('会话不存在或属于其他账号');
    if (
      s.context.kind === 'contest' &&
      s.context.source === 'xcpc' &&
      s.xcpc !== this.store.setting('xcpc-active')
    )
      throw new Error('比赛身份已变化，请新建会话');
    return s;
  }
  private validateContext(context: AgentContext) {
    if (context.kind === 'problem') this.detail(context.problemKey);
    if (context.kind === 'contest') {
      if (context.source === 'xcpc' && !this.store.setting('xcpc-active'))
        throw new Error('请先绑定 XCPC 身份');
      if (
        context.source === 'cf' &&
        !this.store.contests(this.store.active()).some((c) => String(c.id) === context.contestId)
      )
        throw new Error('比赛不存在');
      if (
        context.source === 'atcoder' &&
        !this.store.externalGet(
          'atcoder:' + this.store.activeAtcoder().toLowerCase(),
          'review:' + context.contestId,
        )
      ) {
        // The coach task performs authoritative report lookup; no client report is trusted.
        if (!this.store.activeAtcoder()) throw new Error('请先绑定 AtCoder 账号');
      }
    }
  }
  private detail(key: string) {
    const profile = this.store.profileForKey(key);
    if (
      !profile ||
      ![
        this.store.active(),
        this.store.activeAtcoder() ? 'ac~' + this.store.activeAtcoder().toLowerCase() : '',
      ].includes(profile)
    )
      throw new Error('题目不属于当前账号');
    const d = this.store.detail(profile, key);
    if (!d) throw new Error('题目不存在');
    return d;
  }
  private snapshot() {
    const profiles = [
      this.store.active(),
      this.store.activeAtcoder() ? 'ac~' + this.store.activeAtcoder().toLowerCase() : '',
    ].filter(Boolean);
    return {
      problems: this.store.combinedProblems(),
      learning: new LearningService(this.store).records(),
      goal: this.store.weeklyGoal(),
      xcpc: this.store.setting('xcpc-active'),
      attempts: profiles.flatMap((p) => this.store.all('attempts', p)),
      submissions: profiles.flatMap((p) => this.store.all('submissions', p)),
      plans: [
        ...this.store.all('daily_plans', this.store.active()),
        ...this.store.externalAll(
          `daily:${this.store.active() || '-'}:${this.store.activeAtcoder().toLowerCase()}`,
        ),
      ],
    };
  }
  private revision() {
    return fingerprint(this.snapshot());
  }
  private markHelp(key: string) {
    const d = this.detail(key);
    const session = localDay(new Date()) + ':' + (d.attempts[0]?.id ?? 'first');
    const ns = 'learning-source:' + this.store.profileForKey(key);
    const record = hintSchema.parse({
      ...base(),
      kind: 'hint',
      problemKey: key,
      session,
      level: 1,
      content: '星澪对话提供了解题帮助（不代表完整题解）',
    });
    if (
      !this.store
        .externalAll<{ kind: string; session?: string; problemKey?: string }>(ns)
        .some((r) => r.kind === 'hint' && r.session === session && r.problemKey === key)
    )
      this.store.externalPut(ns, record.id, record);
  }
  private reviewer(signal: AbortSignal) {
    const fetchImpl = this.fetchImpl;
    return new (class extends AiReviewer {
      override complete(config: AiConfig, system: string, user: string, maxTokens = 6000) {
        return astraComplete(config, system, user, maxTokens, fetchImpl, signal);
      }
    })(fetchImpl);
  }
  async task(action: string, input: Record<string, unknown>, signal = AbortSignal.timeout(180000)) {
    const epoch = this.store.learningEpoch,
      ns = this.namespace();
    const learning = new LearningService(this.store, this.reviewer(signal), this.persist);
    let result: unknown;
    if (action === 'review') {
      const key = z.string().parse(input.problemKey),
        d = this.detail(key);
      const data = aiReviewInputSchema.parse(input);
      const content = await this.reviewer(signal).review(
        this.config(),
        { problem: d.problem, submissions: d.submissions },
        data,
      );
      if (signal.aborted || epoch !== this.store.learningEpoch || ns !== this.namespace())
        throw new Error('账号或任务已变化');
      const r = aiReviewRecordSchema.parse({
        ...base(),
        problemKey: key,
        language: data.language,
        verdict: data.verdict,
        model: this.config().model,
        code: data.code,
        ...content,
      });
      this.store.externalPut(aiReviewNamespace(this.store.profileForKey(key)), key + ':' + r.id, r);
      this.markHelp(key);
      result = r;
    } else result = await learning.route(action, 'POST', input);
    await this.persist();
    return result;
  }
  private async proposal(
    run: Run,
    action: Proposal['action'],
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const learning = new LearningService(this.store, this.reviewer(signal), this.persist);
    let before: unknown, after: unknown;
    if (action === 'agent') {
      const raw = await learning.agent({ automatic: false, preview: true });
      const parsed = revisionSchema.safeParse(raw);
      if (!parsed.success) throw new Error((raw as { message?: string })?.message ?? '无法生成题单方案');
      const revision = parsed.data;
      input = { revision };
      before = revision.before;
      after = revision.after;
    } else if (action === 'transfer') {
      const raw = await learning.transfer({ ...input, preview: true });
      const parsed = z
        .object({ record: transferSchema, before: dailyPlanSchema, after: dailyPlanSchema })
        .safeParse(raw);
      if (!parsed.success) throw new Error((raw as { message?: string }).message ?? '无法生成迁移方案');
      const value = parsed.data;
      input = { problemKey: value.record.problemKey, expectedTarget: value.record.targetKey };
      before = value.before;
      after = value.after;
    } else if (action === 'review') {
      const key = z.string().parse(input.problemKey);
      before = this.detail(key).problem.review;
      const patch = z
        .object({
          wrongIdea: z.string().max(50000).optional(),
          rootCause: z.string().max(50000).optional(),
          solution: z.string().max(50000).optional(),
          complexity: z.string().max(50000).optional(),
          counterexample: z.string().max(50000).optional(),
        })
        .strict()
        .parse(input.patch);
      input = { problemKey: key, patch };
      after = { ...(before as object), ...patch };
    } else if (action === 'weekly') {
      before = this.store.weeklyGoal();
      after = input;
    } else {
      const id = z.string().parse(input.id);
      const record = learning.records().find((x) => x.id === id);
      if (!record) throw new Error('学习记录不存在');
      before = record;
      after = action === 'delete' ? null : input;
    }
    if (signal.aborted) throw new Error('任务已取消');
    const proposed = this.save({
      ...base(),
      kind: 'proposal' as const,
      runId: run.id,
      sessionId: run.sessionId,
      action,
      input,
      preview: JSON.stringify({ 操作: action, 修改前: before, 修改后: after }, null, 2).slice(0, 50000),
      fingerprint: this.revision(),
      xcpc: this.store.setting('xcpc-active'),
      status: 'pending' as const,
    });
    return proposed;
  }
  async decide(input: unknown) {
    const { id, approve } = z.object({ id: z.string(), approve: z.boolean() }).parse(input);
    const p = this.records().find((r): r is Proposal => r.kind === 'proposal' && r.id === id);
    if (!p) throw new Error('操作不存在');
    if (p.status !== 'pending') return p;
    let locks = decisions.get(this.store);
    if (!locks) decisions.set(this.store, (locks = new Set()));
    if (locks.has(id)) throw new Error('操作正在执行');
    locks.add(id);
    try {
      this.session(p.sessionId);
      if (!approve) {
        const r = this.save({ ...p, status: 'rejected' });
        await this.persist();
        return r;
      }
      if (p.fingerprint !== this.revision() || p.xcpc !== this.store.setting('xcpc-active')) {
        this.save({ ...p, status: 'expired' });
        await this.persist();
        throw new Error('学习数据已变化，请重新生成方案');
      }
      const epoch = this.store.learningEpoch;
      const learning = new LearningService(
        this.store,
        this.reviewer(AbortSignal.timeout(180000)),
        this.persist,
      );
      let result: unknown;
      if (p.action === 'review') {
        const key = z.string().parse(p.input.problemKey);
        this.detail(key);
        const patch = z
          .object({
            wrongIdea: z.string().max(50000).optional(),
            rootCause: z.string().max(50000).optional(),
            solution: z.string().max(50000).optional(),
            complexity: z.string().max(50000).optional(),
            counterexample: z.string().max(50000).optional(),
          })
          .strict()
          .parse(p.input.patch);
        result = this.store.saveReview(this.store.profileForKey(key), key, {
          ...this.detail(key).problem.review,
          ...patch,
        });
      } else if (p.action === 'weekly') result = this.store.saveWeeklyGoal(p.input);
      else if (p.action === 'agent') result = learning.applyAgentRevision(p.input.revision);
      else result = await learning.route(p.action, 'POST', p.input);
      if (epoch !== this.store.learningEpoch) throw new Error('账号已变化');
      const r = this.save({ ...p, status: 'applied', result: json(result) });
      await this.persist();
      return r;
    } finally {
      locks.delete(id);
    }
  }
  async *run(input: unknown): AsyncGenerator<AgentEvent> {
    this.requireOwner();
    const data = agentRunInputSchema.parse(input),
      s = this.session(data.sessionId),
      ns = this.namespace(),
      epoch = this.store.learningEpoch;
    const existing = this.records().find((r): r is Run => r.kind === 'run' && r.requestId === data.requestId);
    if (existing) {
      if (existing.sessionId !== data.sessionId) throw new Error('请求编号已用于其他会话');
      for (const e of existing.events) yield e;
      return;
    }
    let running = active.get(this.store);
    if (!running) active.set(this.store, (running = new Map()));
    if ([...running.values()].some((r) => r.sessionId === s.id && r.scope === ns))
      throw new Error('当前会话正在生成，请先停止或等待');
    const controller = new AbortController();
    let r: Run = this.save({
      ...base(),
      kind: 'run',
      requestId: data.requestId,
      sessionId: s.id,
      status: 'running',
      events: [],
    });
    running.set(r.id, { controller, sessionId: s.id, scope: ns });
    const timer = setTimeout(() => controller.abort(), 180000);
    const scopeTimer = setInterval(() => {
      if (epoch !== this.store.learningEpoch || ns !== this.namespace()) controller.abort();
    }, 200);
    const guard = () => {
      if (controller.signal.aborted || ns !== this.namespace() || epoch !== this.store.learningEpoch)
        throw new Error('任务已取消或账号已变化');
    };
    const events: AgentEvent[] = [];
    let toolCalls = 0;
    const completedTools = new Map<string, unknown>();
    let currentWriter: ((chunk: unknown) => void) | undefined;
    const emit = (e: AgentEvent) => {
      guard();
      events.push(e);
      currentWriter?.({ astra: e });
    };
    let toolQueue = Promise.resolve();
    const wrap =
      (name: string, fn: (a: any) => Promise<unknown> | unknown) => async (a: any, runtime: ToolRuntime) => {
        const previous = toolQueue;
        let release = () => {};
        toolQueue = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        currentWriter = runtime?.writer ?? undefined;
        try {
          guard();
          if (++toolCalls > 12) throw new Error('已达到本轮工具调用上限');
          emit({ type: 'tool-start', name });
          try {
            const key = name + ':' + fingerprint(a);
            const cached = ['学习任务', '操作方案'].includes(name) && completedTools.has(key);
            const result = cached ? completedTools.get(key) : await fn(a);
            guard();
            if (['学习任务', '操作方案'].includes(name)) completedTools.set(key, result);
            emit({ type: 'tool-end', name, text: cached ? '已完成，复用本轮结果' : '完成' });
            return json(result);
          } catch (e) {
            guard();
            emit({ type: 'tool-end', name, text: (e as Error).message });
            return json({ error: (e as Error).message });
          }
        } finally {
          currentWriter = undefined;
          release();
        }
      };
    const history = this.records()
      .filter(
        (r): r is Extract<AgentRecord, { kind: 'message' }> => r.kind === 'message' && r.sessionId === s.id,
      )
      .slice(-20);
    while (history.reduce((sum, m) => sum + Math.min(m.content.length, 8000), 0) > 24000) history.shift();
    const user = this.save({
      ...base(),
      kind: 'message' as const,
      sessionId: s.id,
      role: 'user' as const,
      content: data.message,
      citations: [],
    });
    await this.persist();
    let answer = '';
    const sources = new Map<string, Citation>();
    const lookedUp = new Set<string>();
    const marked = new Set<string>();
    const append = (event: AgentEvent) => {
      const last = r.events.at(-1);
      if (event.type === 'text' && last?.type === 'text')
        last.text = ((last.text ?? '') + (event.text ?? '')).slice(0, 50000);
      else r.events.push(event);
    };
    const progressOnly =
      /(进度|经验|等级|成就|训练天数)/.test(data.message) &&
      !/(解题|思路|算法|代码|证明|反例|提示|复杂度)/.test(data.message);
    const recordHelp = () => {
      if (progressOnly) return false;
      const keys = [
        ...(s.context.kind === 'problem' ? [s.context.problemKey] : []),
        ...(/解题|思路|算法|代码|证明|边界|反例|提示|复杂度/.test(data.message) ? lookedUp : []),
      ].filter((key) => !marked.has(key));
      if (!keys.length) return false;
      const beforeHelp = this.revision();
      for (const key of keys) {
        this.markHelp(key);
        marked.add(key);
      }
      for (const p of this.records())
        if (
          p.kind === 'proposal' &&
          p.runId === r.id &&
          p.status === 'pending' &&
          p.fingerprint === beforeHelp
        )
          this.save({ ...p, fingerprint: this.revision() });
      return true;
    };
    try {
      this.validateContext(s.context);
      const config = this.config();
      const tools = [
        tool(
          wrap('学习概况', () => ({
            goal: this.store.weeklyGoal(),
            growth: growthSummary(this.store),
            evidence: new LearningService(this.store).evidence('30'),
          })),
          {
            name: 'learning_snapshot',
            description: '查询当前账号的学习证据、周目标与成长。',
            schema: z.object({}),
          },
        ),
        tool(
          wrap('知识检索', ({ query }) => {
            const result = new LearningService(this.store).search(query);
            for (const c of result) sources.set(c.id, c);
            return result;
          }),
          {
            name: 'search_knowledge',
            description: '检索站内算法卡与个人资料，返回可引用来源。',
            schema: z.object({ query: z.string().max(2000) }),
          },
        ),
        tool(
          wrap('题目资料', ({ problemKey }) => {
            lookedUp.add(problemKey);
            return this.detail(problemKey);
          }),
          {
            name: 'problem_detail',
            description: '读取当前账号题目、笔记和提交。读取资料不是解题提示。',
            schema: z.object({ problemKey: z.string().max(200) }),
          },
        ),
        tool(
          wrap('月度报告', ({ month, source }) => monthlyReport(this.store, { month, source })),
          {
            name: 'monthly_report',
            description: '读取真实月报及 fingerprint，再调用 monthly-report 任务解读。',
            schema: z.object({
              month: z.string().regex(/^\d{4}-\d{2}$/),
              source: z.enum(['all', 'cf', 'atcoder']).default('all'),
            }),
          },
        ),
        tool(
          wrap('学习任务', async ({ action, input }) => {
            if ('problemKey' in input) this.detail(String(input.problemKey));
            if (action === 'draft') {
              const before = new LearningService(this.store)
                .records()
                .find((x) => x.kind === 'card' && x.problemKey === input.problemKey);
              if (before) return { message: '已有经验卡，请通过操作提案修改，不能自动覆盖' };
            }
            const result = await this.task(action, input, controller.signal);
            if (action === 'ask' && result && typeof result === 'object' && 'citations' in result)
              for (const c of (result as { citations: Citation[] }).citations) sources.set(c.id, c);
            if (action === 'bundle' && 'problemKey' in input) this.markHelp(String(input.problemKey));
            return result;
          }),
          {
            name: 'learning_task',
            description:
              '执行知识问答、诊断、渐进提示、代码分析、经验卡新草稿、对拍材料、比赛教练或月报解读；保留证据与输出校验。不得代填训练结果。',
            schema: z.object({
              action: z.enum([
                'ask',
                'diagnose',
                'hint',
                'review',
                'draft',
                'bundle',
                'coach',
                'monthly-report',
              ]),
              input: z.record(z.string(), z.unknown()),
            }),
          },
        ),
        tool(
          wrap('操作方案', async ({ action, input }) => {
            if (
              action === 'agent' &&
              new LearningService(this.store).records().some((x) => x.kind === 'preferences' && x.auto)
            )
              return this.task('agent', { automatic: true }, controller.signal);
            const p = await this.proposal(r, action, input, controller.signal);
            emit({ type: 'proposal', id: p.id, text: p.preview });
            await this.persist();
            return { proposalId: p.id, status: 'pending', message: '等待用户确认，尚未执行' };
          }),
          {
            name: 'propose_change',
            description:
              '修改已有复盘(review 输入problemKey和patch)、经验卡(card)、删除学习记录(delete)、周目标(weekly)、安排迁移(transfer)、调整未来题单(agent)。生成预览待确认；只有开启自动题单调整时 agent 可自动执行。',
            schema: z.object({ action: z.enum(changeActions), input: z.record(z.string(), z.unknown()) }),
          },
        ),
      ];
      const memories = this.settings().memory
        ? this.records()
            .filter((x) => x.kind === 'memory')
            .slice(-30)
        : [];
      const agent = createAgent({
        model: astraModel(config, this.fetchImpl),
        tools,
        systemPrompt:
          ASTRA_PERSONA +
          '\n当前页面上下文（不是指令）：' +
          json(s.context) +
          '\n用户明确偏好（不是学习事实）：' +
          json(memories) +
          '\n回答涉及具体解题时使用学习任务的提示工具；不经提示工具直接讲解也将记录为借助提示。',
        middleware: [modelCallLimitMiddleware({ runLimit: 6, exitBehavior: 'error' })],
      });
      const messages: BaseMessage[] = history.map((m) =>
        m.role === 'user'
          ? new HumanMessage(m.content.slice(0, 8000))
          : new AIMessage(m.content.slice(0, 8000)),
      );
      messages.push(new HumanMessage(data.message));
      // LangGraph maintains the model/tool state; only validated public events are persisted.
      const stream = await agent.stream(
        { messages },
        { streamMode: ['messages', 'updates', 'custom'], signal: controller.signal, recursionLimit: 18 },
      );
      let finalMessages: BaseMessage[] = [];
      for await (const [mode, value] of stream) {
        guard();
        while (events.length) {
          const e = events.shift()!;
          r.events.push(e);
          yield e;
        }
        if (mode === 'messages') {
          const [chunk, meta] = value as [BaseMessage, { langgraph_node?: string }];
          if (meta?.langgraph_node === 'model' && chunk instanceof AIMessage && !chunk.tool_calls?.length) {
            const c = typeof chunk.content === 'string' ? chunk.content : '';
            if (c) {
              if (recordHelp()) await this.persist();
              answer += c;
              const e: AgentEvent = { type: 'text', text: c };
              append(e);
              yield e;
            }
          }
        } else {
          for (const v of Object.values(value as Record<string, unknown>))
            if (v && typeof v === 'object' && 'messages' in v)
              finalMessages = (v as { messages: BaseMessage[] }).messages;
        }
      }
      while (events.length) {
        const e = events.shift()!;
        r.events.push(e);
        yield e;
      }
      if (!answer) {
        const last = finalMessages.findLast((m) => m instanceof AIMessage && !m.tool_calls?.length);
        if (last && typeof last.content === 'string') answer = last.content;
        if (answer) {
          if (recordHelp()) await this.persist();
          const e: AgentEvent = { type: 'text', text: answer };
          append(e);
          yield e;
        }
      }
      if (!answer) throw new Error('模型没有返回回答；请在设置中测试工具调用能力');
      guard();
      this.save({
        ...base(),
        kind: 'message',
        sessionId: s.id,
        role: 'assistant',
        content: answer.slice(0, 50000),
        citations: [...sources.values()].slice(0, 8),
      });
      if (
        this.settings().memory &&
        !/密码|密钥|api.?key|token/i.test(data.message) &&
        /^(?:(?:请)?(?:记住|记一下)[：:\s]|我的目标是|我(?:更)?喜欢|我习惯)/.test(data.message)
      ) {
        const content = data.message.replace(/^(?:请)?(?:记住|记一下)[：:\s]+/, '').slice(0, 2000);
        if (content && !this.records().some((x) => x.kind === 'memory' && x.content === content))
          this.save({ ...base(), kind: 'memory', content, sourceId: user.id });
      }
      const complete: AgentEvent = { type: 'complete', id: r.id };
      r.events.push(complete);
      this.save({ ...r, status: 'completed' });
      await this.persist();
      yield complete;
    } catch (error) {
      const e = error as Error & { status?: number };
      const message = (
          e.status === 400
            ? '模型拒绝工具调用，请在设置中测试能力；原有结构化任务仍可使用'
            : e.status === 401 || e.status === 403
              ? 'API 密钥无效或已过期'
              : e.status === 429
                ? 'AI 服务请求过于频繁，请稍后重试'
                : /Connection|fetch failed/i.test(e.message)
                  ? '无法连接 AI 服务，请检查网络'
                  : e.message
        ).slice(0, 2000),
        cancelled =
          controller.signal.aborted || epoch !== this.store.learningEpoch || ns !== this.namespace();
      if (epoch === this.store.learningEpoch && this.store.externalGet(ns, s.id)) {
        if (answer)
          this.save(
            {
              ...base(),
              kind: 'message',
              sessionId: s.id,
              role: 'assistant',
              content: answer.slice(0, 50000),
              citations: [...sources.values()].slice(0, 8),
            },
            ns,
          );
        r.events.push({ type: 'error', text: message, id: r.id });
        this.save({ ...r, status: cancelled ? 'cancelled' : 'failed', error: message }, ns);
        await this.persist();
      }
      yield { type: 'error', text: cancelled ? '任务已停止；已完成操作保留' : message, id: r.id };
    } finally {
      clearTimeout(timer);
      clearInterval(scopeTimer);
      controller.abort();
      running.delete(r.id);
      const saved = this.store.externalGet<Run>(ns, r.id);
      if (epoch === this.store.learningEpoch && saved?.kind === 'run' && saved.status === 'running') {
        this.save({ ...r, status: 'cancelled' }, ns);
        await this.persist();
      }
    }
  }
  async route(action: string, method: string, input: unknown = {}, query: Record<string, string> = {}) {
    this.requireOwner();
    if (method === 'GET' && action === 'sessions')
      return this.records().filter(
        (r) =>
          r.kind === 'session' &&
          !(
            r.context.kind === 'contest' &&
            r.context.source === 'xcpc' &&
            r.xcpc !== this.store.setting('xcpc-active')
          ),
      );
    if (method === 'GET' && action === 'history') {
      const s = this.session(query.sessionId);
      return this.records().filter((r) => 'sessionId' in r && r.sessionId === s.id && r.kind !== 'run');
    }
    if (method === 'GET' && action === 'settings') return this.settings();
    if (method === 'GET' && action === 'memories') return this.records().filter((r) => r.kind === 'memory');
    if (method === 'GET' && action === 'runs')
      return this.records()
        .filter((r) => r.kind === 'run')
        .map((r) =>
          r.kind === 'run' && r.status === 'running' && !active.get(this.store)?.has(r.id)
            ? { ...r, status: 'cancelled' }
            : r,
        );
    if (method === 'POST' && action === 'sessions') {
      const { context } = z.object({ context: agentContextSchema.default({ kind: 'general' }) }).parse(input);
      this.validateContext(context);
      return this.save({
        ...base(),
        kind: 'session',
        title: '与星澪的对话',
        context,
        xcpc: this.store.setting('xcpc-active'),
      });
    }
    if (method === 'PUT' && action === 'settings')
      return this.save(
        agentRecordSchema.options
          .find((o) => o.shape.kind.value === 'settings')!
          .parse({ ...(input as object), kind: 'settings', id: 'settings' }) as Extract<
          AgentRecord,
          { kind: 'settings' }
        >,
      );
    if (method === 'POST' && action === 'decision') return this.decide(input);
    if (method === 'POST' && action === 'cancel') {
      const { sessionId } = z.object({ sessionId: z.string() }).parse(input);
      this.session(sessionId);
      for (const r of active.get(this.store)?.values() ?? [])
        if (r.scope === this.namespace() && r.sessionId === sessionId) r.controller.abort();
      return { ok: true };
    }
    if (method === 'PUT' && action === 'memory') {
      const { id, content } = z
        .object({ id: z.string(), content: z.string().trim().min(1).max(2000) })
        .parse(input);
      const r = this.records().find((x) => x.kind === 'memory' && x.id === id);
      if (!r || r.kind !== 'memory') throw new Error('记忆不存在');
      return this.save({ ...r, content });
    }
    if (method === 'DELETE' && (action === 'memory' || action === 'session')) {
      const { id } = z.object({ id: z.string() }).parse(input);
      const r = this.records().find(
        (x) => x.id === id && x.kind === (action === 'memory' ? 'memory' : 'session'),
      );
      if (!r) throw new Error('记录不存在');
      if (action === 'session') {
        await this.route('cancel', 'POST', { sessionId: id });
        for (const x of this.records())
          if ('sessionId' in x && x.sessionId === id) this.store.externalDelete(this.namespace(), x.id);
      }
      this.store.externalDelete(this.namespace(), id);
      return { ok: true };
    }
    if (method === 'POST' && action === 'suggestion') return this.suggest(input);
    if (method === 'POST' && action === 'dismiss') {
      const { id } = z.object({ id: z.string() }).parse(input);
      const r = this.records().find((x) => x.kind === 'suggestion' && x.id === id);
      if (r?.kind === 'suggestion') this.save({ ...r, dismissed: true });
      return { ok: true };
    }
    throw new Error('智能体接口不存在');
  }
  async suggest(input: unknown) {
    if (!this.settings().proactive) return null;
    const ns = this.namespace();
    let locks = suggestionLocks.get(this.store);
    if (!locks) suggestionLocks.set(this.store, (locks = new Set()));
    if (locks.has(ns)) return null;
    locks.add(ns);
    try {
      const date = localDay(new Date()),
        hash = this.revision(),
        today = this.records().filter(
          (r): r is Extract<AgentRecord, { kind: 'suggestion' }> =>
            r.kind === 'suggestion' && r.date === date,
        );
      const found = today.find((x) => x.fingerprint === hash);
      if (found) return found.dismissed ? null : found;
      if (today.length >= 2) return null;
      const epoch = this.store.learningEpoch;
      const reservation = this.save({
        ...base(),
        kind: 'suggestion',
        date,
        fingerprint: hash,
        content: '',
        dismissed: true,
      });
      await this.persist();
      const content = await astraComplete(
        this.config(),
        '根据学习证据提出一条简短、具体的建议，不调用写工具，不编造已完成行为。',
        json({
          context: input,
          evidence: new LearningService(this.store).evidence('30'),
          goal: this.store.weeklyGoal(),
        }),
        500,
        this.fetchImpl,
      );
      if (epoch !== this.store.learningEpoch || ns !== this.namespace() || hash !== this.revision())
        return null;
      const r = this.save({ ...reservation, content, dismissed: false });
      await this.persist();
      return r;
    } finally {
      locks.delete(ns);
    }
  }
}
