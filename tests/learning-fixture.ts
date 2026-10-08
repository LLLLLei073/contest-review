export function learningReply(system: string, data: Record<string, unknown>) {
  if ('metrics' in data && 'month' in data)
    return { findings: [{ title: '月度训练建议', cause: '依据本月提交与训练证据安排复习。',
      action: '下月保持固定训练时段，优先复习薄弱算法。', evidenceIds: ['monthly:volume'] }], warnings: [] };
  if ('question' in data)
    return {
      answer: '资料显示需要先证明循环不变量，并检查边界。',
      general: '通用解释：用小规模暴力检验算法。',
      citationIds: (data.citations as { id: string }[]).slice(0, 2).map((c) => c.id),
    };
  if ('candidates' in data) {
    const candidates = data.candidates as { key: string; tags: string[] }[];
    const maths = candidates.filter((c) => c.tags.includes('math'));
    return {
      keys: [
        ...maths.slice(0, 2),
        ...candidates.filter((c) => !maths.slice(0, 2).some((m) => m.key === c.key)),
      ]
        .slice(0, 5)
        .map((c) => c.key)
        .reverse(),
      reason: '依据复盘证据优先训练边界与实现，并覆盖本周目标。',
    };
  }
  if (system.includes('数据生成器'))
    return {
      oracle: '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<2*n;}',
      generator: 'console.log((Number(process.argv[2])+Number(process.argv[3]))%10+1)',
    };
  if ('evidence' in data) {
    const evidence = data.evidence as { id: string }[];
    return {
      findings: evidence.length
        ? [
            {
              evidenceIds: [evidence[0].id],
              cause: '证据显示需要复核边界条件。',
              action: '练习二分循环不变量，并记录重做结果。',
              knowledgeIds: ['binary-search'],
            },
          ]
        : [],
      warnings: ['用时缺失时不作时间诊断。'],
    };
  }
  return { content: '从区间不变量开始，检查最小输入与边界。' };
}
