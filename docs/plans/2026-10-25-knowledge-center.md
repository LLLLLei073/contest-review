# 知识中心完善 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成用户已确认的知识卡内容、统一检索、关联经验与练习改进。

**Architecture:** 保留本地优先与服务端 / Pages 双运行模式。算法资料与检索规则在 shared 层复用，页面负责筛选、阅读和来源导航；经验确认及来源有效性规则沿用现有服务。

**Tech Stack:** Vue 3、TypeScript、Fastify、SQLite / IndexedDB、Playwright。

---

### Task 1: 丰富可离线阅读的知识卡

- 新建 `shared/knowledge-guides.ts`，为现有 14 个知识点补充适用信号、解题步骤、易错点、自检练习。
- `shared/knowledge.ts` 保留稳定 ID、标签和先修关系，整合摘要与正文。
- 审核算法前提、复杂度、例题答案及资料链接。

### Task 2: 统一检索与筛选

- `shared/knowledge.ts` 复用规范化与多词匹配，`shared/learning-service.ts` 补齐关联知识别名。
- `src/pages/Knowledge.vue` 同时筛选知识与个人经验，明确加载、无匹配、失败重试、清空和当前检索结果。
- `tests/knowledge-search.test.ts` 验证查询规范化、关联知识检索和个人来源边界。

### Task 3: 连接阅读、经验和练习

- `src/components/knowledge/KnowledgeReader.vue` 展示摘要、先修 / 后续知识、关联个人经验以及准确的练习入口。
- `src/pages/Knowledge.vue` 保留筛选上下文、修复经验深链和无效来源定位，保留编辑草稿。
- 保持现有问答、确认、刷新、删除与图谱能力，支持窄屏和深色模式。

### Task 4: 验证完整流程

- `tests/e2e/knowledge.spec.ts` 覆盖筛选、目录切换、来源导航、空状态与移动端布局。
- 执行共享层测试、类型检查、本地与 Pages 构建。
- 两种运行模式执行知识中心及既有学习闭环回归，检查页面截图和运行时异常。
- 记录验收证据；本轮不包含发布操作。

工作区原有未提交的比赛报告、统计和缓存改动保留，不纳入本轮编辑。

## 完成状态

四项任务已完成。实现范围、两种运行模式的测试证据与构建限制见 [知识中心验收](../verification/knowledge-center.md)。
