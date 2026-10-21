# 第二版重构验收索引

日期：2026-10-19。范围为 F01–F57；测试使用内存、临时数据库或隔离浏览器存储，不使用用户 `data/`。下表列出具体调整及对应验证入口。最终执行结果见 [验收记录](../verification.md)：核心 170 通过、1 可选跳过，本地浏览器 30 通过，Pages 浏览器 29 通过、4 项模式限定跳过。构建及类型检查通过。

| ID  | 实现位置与可感知调整                                                | 验证入口                                                                   |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| F01 | App、navigation、CommandPalette：八入口分组、快捷键与旧链接         | workbench、experience E2E                                                  |
| F02 | App：CF/AC/XCPC 组合档案摘要与同步状态                              | workflow、monthly、pages/atcoder E2E                                       |
| F03 | NextAction、TrainingLane：下一步和剩余动作                          | workbench/training 核心，weekly E2E                                        |
| F04 | TrainingLane、PlanningService：推荐原因、知识链接与估时             | planning/training 核心，planning E2E                                       |
| F05 | WeeklyGoalScene：紧凑目标面板和影响说明                             | weekly、growth-weekly E2E                                                  |
| F06 | Dashboard：检查中、最近成功、失败重试保留题单                       | training/atcoder 核心，pages/redo E2E                                      |
| F07 | PlanningWorkspace、LearningService：预览、确认、历史与撤回          | planning/learning 核心，planning E2E                                       |
| F08 | LearningActivity：迁移状态筛选和来源跳转                            | learning 核心与 E2E                                                        |
| F09 | problem-filters、useProblemFilters：全筛选 URL 与常用视图           | problem-filters 核心，workflow E2E                                         |
| F10 | Problems：字段反馈、重复检查与已有题入口                            | workflow E2E                                                               |
| F11 | Problems、ProblemTable：忽略视图、后果说明、恢复                    | workflow E2E                                                               |
| F12 | ReviewEditor：步骤导航、固定保存、质量提示                          | workflow、legacy-review E2E                                                |
| F13 | ReviewEditor、代码留档：预览与独立滚动                              | workflow、visual-audit E2E                                                 |
| F14 | EvidenceTimeline、ProblemDetail：提交来源与粘贴降级                 | learning-evidence 核心，workflow E2E                                       |
| F15 | ReviewProgress：阶段与预计复习日期                                  | training 核心，pages/redo E2E                                              |
| F16 | LearningProblem：代码快照摘要与填入反馈                             | learning 核心与 E2E                                                        |
| F17 | LearningProblem：提示级别进度与顺序控制                             | learning 核心与 E2E                                                        |
| F18 | LearningProblem：对拍材料与报告分步展示                             | learning 核心与 E2E；Python 执行可选项另列                                 |
| F19 | LearningProblem、Knowledge：生成后直达经验草稿                      | learning 核心与 E2E                                                        |
| F20 | Contests、ContestFilters：报告状态筛选进入 URL                      | contest-navigation、analysis E2E                                           |
| F21 | ContestReport：行动建议优先、评分依据折叠                           | analysis 核心与 E2E                                                        |
| F22 | AtcoderReport：官方与分析分区、目录修复入口                         | atcoder 核心与 Pages E2E                                                   |
| F23 | XcpcReport：团队建议优先、全场口径标明                              | xcpc 核心，analysis E2E                                                    |
| F24 | BatchProgress：批处理进度与继续处理                                 | analysis/xcpc 核心，analysis E2E                                           |
| F25 | LearningCoach：上下文标记与补题入口                                 | learning、contest-navigation E2E                                           |
| F26 | UpsolveList：比赛分组与完成筛选                                     | weekly E2E，training-extras 核心                                           |
| F27 | Simulation：检索、历史提示与加载更多                                | weekly、visual-audit E2E                                                   |
| F28 | Simulation：专注计时与结束后复盘链接                                | weekly E2E，training-extras 核心                                           |
| F29 | Statistics：样本不足语义、薄弱领域入口                              | training 核心，visual-audit E2E                                            |
| F30 | Statistics：趋势数据表及错因/标签跳转                               | workflow、weekly E2E                                                       |
| F31 | LearningActivity：观察、建议与路径入口分层                          | learning 核心与 E2E                                                        |
| F32 | MonthlyReport：摘要优先、打印与证据链接                             | monthly 核心与 E2E                                                         |
| F33 | KnowledgeReader：知识目录与单篇阅读                                 | learning、visual-audit E2E                                                 |
| F34 | Knowledge：经验草稿/已确认/失效筛选与来源                           | learning 核心与 E2E                                                        |
| F35 | Knowledge：答案与引用双栏、移动端单列                               | learning 核心与 E2E                                                        |
| F36 | KnowledgeGraph：邻域、检索、类型和完整列表                          | visual-audit E2E 的 45 题图谱                                              |
| F37 | Companion、SessionList：搜索会话、上下文与取消                      | agent 核心与 E2E                                                           |
| F38 | ProposalCard：统一预览、确认、失效与执行结果                        | agent/review-workflow 核心，agent E2E                                      |
| F39 | MemoryPanel：来源可查的管理抽屉                                     | agent 核心与 E2E                                                           |
| F40 | Growth：里程碑导航、历史类型过滤及来源                              | growth 核心与 E2E                                                          |
| F41 | GrowthWeekly、App：待覆盖领域、直接行动、通知明细折叠               | growth-weekly 核心与 E2E                                                   |
| F42 | Growth：外观预览独立于装备与解锁                                    | growth、visual-audit E2E                                                   |
| F43 | AccountConnections、Settings：平台卡片、验证来源与字段反馈          | workflow、pages/atcoder E2E                                                |
| F44 | SyncStatus、DataHealth：统一进度和修复链接                          | sync/atcoder 核心，workflow E2E                                            |
| F45 | BackupPanel、backup-summary：恢复预览与 v11 契约                    | settings-workbench/planning/review-workflow 核心，workflow/persistence E2E |
| F46 | AiConfiguration、ai-configuration：测试与保存分离、地址变更密钥保护 | settings-workbench/ai-models 核心，ai-models E2E                           |
| F47 | Settings：存储与离线范围、多标签恢复步骤可见                        | pages/persistence E2E                                                      |
| F48 | tokens/layout、对话框与导航：明暗、焦点、减少动画                   | workbench/motion/visual-audit E2E，十页面三宽度双主题                      |
| F49 | review-workflow、GuidedReview：六阶段工具循环                       | review-workflow 核心，guided-review E2E                                    |
| F50 | review-workflow：证据/假设/回答及验证检查点                         | review-workflow 核心，guided-review E2E                                    |
| F51 | review-workflow、CoreStore：续接、取消、账号与恢复校验              | review-workflow 核心，guided-review/agent E2E                              |
| F52 | AgentService：工具预算、去重、取消、能力降级                        | agent/review-workflow 核心                                                 |
| F53 | knowledge-tracing、PlanningService：BKT、证据筛选与版本缓存         | knowledge-tracing/planning 核心                                            |
| F54 | learning-path：完整先修闭包、确定性拓扑和参考负担                   | learning-path 核心，planning E2E                                           |
| F55 | plan-optimizer：预算与配额 DP、必选约束                             | plan-optimizer 随机穷举对照，planning E2E                                  |
| F56 | PlanningService、PlanPreview：换题校验、版本解释、精确撤回          | planning/learning/agent 核心，planning E2E                                 |
| F57 | planner-evaluation/outcomes、evaluate-planner：历史回放及后续观察   | planner-evaluation/planning 核心，合成回放报告                             |

核心用例对应 `tests/*.test.ts`；浏览器用例对应 `tests/e2e/*.spec.ts` 与 `tests/pages/*.spec.ts`。具体日志、截图与未覆盖边界由总验证记录给出。
