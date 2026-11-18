import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { Store } from '../server/store.js';
import { PlanningService } from '../shared/planning-service.js';
import { evaluateKnowledgePredictions } from '../shared/planner-evaluation.js';
import { knowledgeCards, knowledgeFor } from '../shared/knowledge.js';
import { localDay } from '../shared/core-store.js';
import { estimateMinutes } from '../shared/plan-optimizer.js';
import type { Catalog } from '../shared/training.js';

const { values } = parseArgs({
  options: {
    backup: { type: 'string' },
    'as-of': { type: 'string' },
    output: { type: 'string' },
    budget: { type: 'string' },
    calibrate: { type: 'boolean', default: false },
    'save-calibration': { type: 'boolean', default: false },
  },
});
if (!values.backup || !values['as-of'])
  throw new Error(
    '用法：node --import tsx scripts/evaluate-planner.ts --backup <历史导出文件> --as-of <ISO时间> [--budget 90] [--output report.json] [--calibrate] [--save-calibration]',
  );
const input = resolve(values.backup),
  asOf = new Date(values['as-of']);
if (!Number.isFinite(asOf.getTime())) throw new Error('截止时间无效');
const budget = values.budget === undefined ? 90 : Number(values.budget);
if (!Number.isInteger(budget) || budget < 15 || budget > 240) throw new Error('预算必须为 15–240 分钟');
const backup = JSON.parse(readFileSync(input, 'utf8'));
const store = new Store(':memory:');
try {
  // Restore validates in an isolated, in-memory database. Never open the user's live database.
  store.restore(backup);
  const planner = new PlanningService(store, () => asOf);
  const observations = planner.observations(asOf.toISOString());
  const predictions = evaluateKnowledgePredictions(
    observations,
    knowledgeCards.map((k) => k.id),
    asOf.toISOString(),
  );
  // 参数校准只做全局 4 参数（单用户样本不足以 per-skill 拟合），网格搜索最小 Brier。
  let calibration: unknown = null;
  if (values.calibrate) {
    const grid = [];
    for (const initial of [0.15, 0.2, 0.3])
      for (const learn of [0.05, 0.1, 0.2])
        for (const guess of [0.15, 0.2, 0.25])
          for (const slip of [0.05, 0.1, 0.15]) {
            const result = evaluateKnowledgePredictions(
              observations,
              knowledgeCards.map((k) => k.id),
              asOf.toISOString(),
              { initial, learn, guess, slip },
            );
            if (result.brier === null) continue;
            grid.push({ parameters: { initial, learn, guess, slip }, brier: result.brier, samples: result.samples });
          }
    grid.sort((a, b) => a.brier - b.brier);
    const best = grid[0] ?? null;
    const skillSamples = Object.fromEntries(
      knowledgeCards.map((card) => {
        const rows = predictions.rows.filter((r) => r.skillId === card.id);
        return [card.id, { rows: rows.length, problems: new Set(predictions.rows.filter((r) => r.skillId === card.id).map((r) => r.id)).size }];
      }),
    );
    calibration = {
      samples: predictions.samples,
      sufficient: !predictions.insufficient,
      threshold: 30,
      defaultBrier: predictions.brier,
      best,
      improvement: best && predictions.brier !== null ? predictions.brier - best.brier : null,
      evaluated: grid.length,
      skillSamples,
      action: !best
        ? '无可回放样本，未做拟合'
        : predictions.insufficient
          ? `样本 ${predictions.samples} 条低于门槛 30，结果仅作参考，不保存校准参数`
          : values['save-calibration']
            ? '样本达标：已写入校准（独立评估模型，非能力评测）'
            : '样本达标：加 --save-calibration 可写入校准参数',
    };
    if (values['save-calibration'] && best && !predictions.insufficient) {
      planner.saveCalibration({
        parameters: best.parameters,
        samples: predictions.samples,
        brier: best.brier,
        defaultBrier: predictions.brier,
        source: `cli-replay:${input}`,
      });
    }
  }
  const catalog = store.get<Catalog>('catalog_cache', store.active(), 'current');
  const reasons: string[] = [];
  if (Date.parse(backup.exportedAt) > asOf.getTime())
    reasons.push('导出晚于截止时间，缺少当时的复盘/目录快照，禁止用当前状态伪造历史推荐');
  if (!catalog || Date.parse(catalog.fetchedAt) > asOf.getTime()) reasons.push('缺少截止时间之前的题库快照');
  const date = localDay(new Date(asOf.getTime() + 86400000));
  let comparison: unknown = { comparable: false, reasons };
  if (!reasons.length) {
    const decision = planner.preview({ date, budget, targets: planner.options().targets });
    const original = store.combinedTrainingDay(new Date(date + 'T12:00:00+08:00'));
    const byKey = new Map(catalog!.problems.map((p) => [p.key, p]));
    const originalCost =
      original.review.length * estimateMinutes([], 'review').minutes +
      original.newProblems.length * estimateMinutes([], 'new').minutes;
    const coverage = (keys: string[]) => [
      ...new Set(keys.flatMap((key) => knowledgeFor(byKey.get(key)?.tags ?? []))),
    ];
    comparison = {
      comparable: true,
      scope: '仅在给定已保存历史快照上比较，未重建快照之间的状态',
      date,
      budget,
      old: {
        review: original.review.map((p) => p.key),
        newKeys: original.newProblems.map((p) => p.key),
        estimatedMinutes: originalCost,
        overBudget: originalCost > budget,
        knowledgeCoverage: coverage(original.newProblems.map((p) => p.key)),
      },
      proposed: {
        feasible: decision.result.feasible,
        conflicts: decision.result.conflicts,
        review: decision.after.review.map((p) => p.key),
        newKeys: decision.after.newKeys,
        allocatedMinutes: decision.result.allocatedMinutes,
        overBudget: decision.result.allocatedMinutes > budget,
        knowledgeCoverage: coverage(decision.after.newKeys),
      },
      costLimit: '旧规则计划使用明确的默认估时；与按个人样本估时的计划比较时不得解释为实际耗时差',
    };
  }
  const report = {
    format: 'contest-review-planner-evaluation',
    version: 1,
    source: input,
    asOf: asOf.toISOString(),
    comparison,
    predictions,
    calibration,
    learningEffect: '待持续使用数据观察；完成率、提示依赖、逾期积压和单位时间独立完成数仅作描述性指标',
  };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (values.output) {
    const target = resolve(values.output);
    if (target.toLowerCase() === input.toLowerCase()) throw new Error('输出不能覆盖原始备份');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output);
    process.stdout.write(target + '\n');
  } else process.stdout.write(output);
} finally {
  store.close();
}
