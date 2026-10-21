import { z } from 'zod';
import { CoreStore } from './core-store.js';
import { agentNamespace, type AgentRecord } from './agent-domain.js';
import { fingerprint } from './learning-domain.js';
import {
  reviewStages,
  reviewWorkflowSchema,
  workflowNamespace,
  type ReviewWorkflow,
} from './review-workflow-domain.js';

export const stageLabels: Record<ReviewWorkflow['stage'], string> = {
  orient: '确认情境',
  recall: '回忆过程',
  investigate: '查证原因',
  verify: '验证假设',
  consolidate: '沉淀复盘',
  transfer: '迁移与安排',
};
export const checkpointSchema = z.object({
  summary: z.string().trim().min(1).max(5000),
  question: z.string().trim().min(1).max(3000),
  hypothesis: z.string().max(2000).default(''),
  advance: z.boolean().default(false),
});
export class ReviewWorkflowService {
  constructor(readonly store: CoreStore) {}
  scope() {
    return workflowNamespace(this.store.active(), this.store.activeAtcoder());
  }
  private agents() {
    return agentNamespace(this.store.active(), this.store.activeAtcoder());
  }
  private save(value: ReviewWorkflow) {
    const parsed = reviewWorkflowSchema.parse(value);
    if (parsed.scope !== this.scope()) throw new Error('复盘账号已变化');
    this.store.externalPut(this.scope(), parsed.id, parsed);
    return parsed;
  }
  records() {
    return this.store.externalAll<ReviewWorkflow>(this.scope()).map((r) => reviewWorkflowSchema.parse(r));
  }
  read(id: string) {
    const raw = this.store.externalGet(this.scope(), id);
    if (!raw) throw new Error('复盘流程不存在或属于其他账号');
    const r = reviewWorkflowSchema.parse(raw),
      session = this.store.externalGet<AgentRecord>(this.agents(), r.sessionId);
    if (session?.kind !== 'session' || fingerprint(session.context) !== fingerprint(r.context))
      throw new Error('关联会话已失效');
    if (
      r.context.kind === 'contest' &&
      r.context.source === 'xcpc' &&
      r.xcpc !== this.store.setting('xcpc-active')
    )
      throw new Error('比赛身份已变化');
    return r;
  }
  contextEvidence(r: ReviewWorkflow) {
    const context = r.context;
    if (context.kind === 'problem') {
      const profile = this.store.profileForKey(context.problemKey);
      if (
        ![
          this.store.active(),
          this.store.activeAtcoder() ? 'ac~' + this.store.activeAtcoder().toLowerCase() : '',
        ]
          .filter(Boolean)
          .includes(profile)
      )
        throw new Error('题目不属于当前账号');
      const detail = this.store.detail(profile, context.problemKey);
      if (!detail) throw new Error('题目不存在');
      return detail;
    }
    if (context.kind !== 'contest') throw new Error('引导复盘需要题目或比赛上下文');
    if (context.source === 'cf') {
      const contest = this.store
        .contests(this.store.active())
        .find((c) => String(c.id) === context.contestId);
      if (!contest) throw new Error('比赛不存在');
      return {
        report: this.store.analysis(this.store.active(), Number(context.contestId)),
        notes: contest.review,
        limitations: '仅赛时记录可作为比赛证据；提交间隔不等于思考时长。',
      };
    }
    const ns =
      context.source === 'atcoder'
        ? 'atcoder:' + this.store.activeAtcoder().toLowerCase()
        : 'xcpc:' + this.store.setting('xcpc-active');
    const report = this.store.externalGet(ns, 'report:' + context.contestId);
    if (!report) throw new Error('请先获取比赛报告');
    return {
      report,
      notes: this.store.externalGet(ns, 'review:' + context.contestId),
      limitations:
        context.source === 'xcpc'
          ? '队伍及全场数据，不能推断个人逐题行为。'
          : '官方成绩与已同步提交分别解读。',
    };
  }
  start(sessionId: string) {
    const session = this.store.externalGet<AgentRecord>(this.agents(), sessionId);
    if (session?.kind !== 'session') throw new Error('会话不存在');
    const existing = this.records().find(
      (r) => r.sessionId === sessionId && !['completed', 'cancelled'].includes(r.status),
    );
    if (existing) return this.read(existing.id);
    const at = new Date().toISOString();
    const r = reviewWorkflowSchema.parse({
      kind: 'workflow',
      id: crypto.randomUUID(),
      scope: this.scope(),
      sessionId,
      context: session.context,
      xcpc: session.xcpc,
      stage: 'orient',
      status: 'ready',
      version: 1,
      fingerprint: 'pending',
      createdAt: at,
      updatedAt: at,
      question: '',
      summary: '准备读取已有记录，先确认复盘范围。',
      answers: [],
      evidence: [],
      proposalIds: [],
    });
    r.fingerprint = fingerprint(this.contextEvidence(r));
    return this.save(r);
  }
  respond(id: string, input: unknown) {
    const data = z
        .object({
          id: z.string().min(1).max(100),
          version: z.number().int(),
          text: z.string().trim().min(1).max(10000),
        })
        .parse(input),
      r = this.read(id);
    const duplicate = r.answers.find((a) => a.id === data.id);
    if (duplicate) {
      if (duplicate.text !== data.text) throw new Error('回答编号已被使用');
      return r;
    }
    if (r.version !== data.version) throw new Error('复盘进度已更新，请刷新后继续');
    if (!['waiting', 'interrupted', 'cancelled'].includes(r.status)) throw new Error('请等待当前步骤结束');
    if (r.answers.length >= 100) throw new Error('此流程已达回答上限，请新建会话');
    const wasInterrupted = r.status !== 'waiting';
    if (wasInterrupted) this.expireProposals(r);
    const at = new Date().toISOString();
    r.answers.push({ id: data.id, stage: r.stage, text: data.text, createdAt: at });
    r.evidence.push({
      id: 'answer:' + data.id,
      label: stageLabels[r.stage] + ' · 用户回答',
      status: 'user-reported',
      summary: data.text.slice(0, 2000),
    });
    r.evidence = r.evidence.slice(-100);
    const next = reviewStages.indexOf(r.stage) + 1;
    if (!wasInterrupted && r.advance && next === reviewStages.length) r.status = 'completed';
    else {
      if (!wasInterrupted && r.advance) r.stage = reviewStages[next];
      r.status = 'ready';
    }
    r.question = '';
    r.advance = false;
    r.version++;
    r.updatedAt = at;
    r.fingerprint = fingerprint(this.contextEvidence(r));
    return this.save(r);
  }
  begin(id: string, sessionId: string, requestId: string) {
    const r = this.read(id);
    if (r.sessionId !== sessionId) throw new Error('流程与会话不匹配');
    if (r.status !== 'ready') throw new Error('本步骤已执行或仍在等待回答');
    r.status = 'running';
    r.lastRequestId = requestId;
    r.fingerprint = fingerprint(this.contextEvidence(r));
    r.updatedAt = new Date().toISOString();
    return this.save(r);
  }
  observe(id: string, requestId: string, label: string, summary: string) {
    const r = this.read(id);
    if (r.status !== 'running' || r.lastRequestId !== requestId) throw new Error('复盘步骤已停止');
    r.evidence.push({
      id: crypto.randomUUID(),
      label: label.slice(0, 300),
      status: 'observed',
      summary: summary.slice(0, 2000),
    });
    r.evidence = r.evidence.slice(-100);
    return this.save(r);
  }
  checkpoint(id: string, requestId: string, input: unknown) {
    const r = this.read(id);
    if (r.status !== 'running' || r.lastRequestId !== requestId) throw new Error('复盘步骤已停止');
    const data = checkpointSchema.parse(input);
    r.summary = data.summary;
    r.question = data.question;
    r.advance = data.advance;
    if (data.hypothesis)
      r.evidence.push({
        id: crypto.randomUUID(),
        label: '待验证假设',
        status: 'hypothesis',
        summary: data.hypothesis,
      });
    r.evidence = r.evidence.slice(-100);
    return this.save(r);
  }
  proposal(id: string, requestId: string, proposalId: string) {
    const r = this.read(id);
    if (r.status !== 'running' || r.lastRequestId !== requestId) throw new Error('复盘步骤已停止');
    if (!r.proposalIds.includes(proposalId)) r.proposalIds.push(proposalId);
    return this.save(r);
  }
  finish(id: string, requestId: string, success: boolean) {
    const r = this.read(id);
    if (r.lastRequestId !== requestId || r.status !== 'running') return r;
    r.status = success && r.question ? 'waiting' : 'interrupted';
    if (r.status === 'interrupted') {
      r.summary = '此步未完成，可以继续查证或使用原有结构化工具。';
      r.advance = false;
      this.expireProposals(r);
    }
    r.version++;
    r.updatedAt = new Date().toISOString();
    r.fingerprint = fingerprint(this.contextEvidence(r));
    return this.save(r);
  }
  cancel(id: string) {
    const r = this.read(id);
    r.status = 'cancelled';
    r.advance = false;
    r.version++;
    r.updatedAt = new Date().toISOString();
    this.expireProposals(r);
    return this.save(r);
  }
  private expireProposals(r: ReviewWorkflow) {
    for (const id of r.proposalIds) {
      const p = this.store.externalGet<AgentRecord>(this.agents(), id);
      if (p?.kind === 'proposal' && p.status === 'pending')
        this.store.externalPut(this.agents(), id, { ...p, status: 'expired' });
    }
  }
  interruptOrphan(id: string) {
    const r = this.read(id);
    return r.status === 'running' ? this.finish(id, r.lastRequestId!, false) : r;
  }
}
