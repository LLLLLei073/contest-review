<script setup lang="ts">
import type { AgentRecord } from '../../../shared/agent-domain';
defineProps<{ proposal: Extract<AgentRecord, { kind: 'proposal' }>; busy: boolean }>();
const emit = defineEmits<{ decide: [id: string, approve: boolean] }>();
const labels = {
  review: '保存复盘笔记',
  card: '修改或确认经验卡',
  delete: '删除学习记录',
  weekly: '更新本周目标',
  transfer: '安排迁移任务',
  agent: '调整未来题单',
};
const statuses = { pending: '待确认', applied: '已执行', expired: '已失效', rejected: '已拒绝' };
</script>
<template>
  <article class="astra-proposal" :aria-label="labels[proposal.action]">
    <h3>{{ labels[proposal.action] }} · {{ statuses[proposal.status] }}</h3>
    <p v-if="proposal.status === 'pending'" class="small subtle">
      核对变更前后内容；确认时会再次检查当前学习数据。
    </p>
    <pre>{{ proposal.preview }}</pre>
    <div v-if="proposal.status === 'pending'" class="button-row">
      <button class="button primary" :disabled="busy" @click="emit('decide', proposal.id, true)">
        确认执行</button
      ><button class="button" :disabled="busy" @click="emit('decide', proposal.id, false)">拒绝</button>
    </div>
    <p v-if="proposal.status === 'expired'" class="small">资料或流程已变化，请重新生成方案。</p>
    <details v-if="proposal.result">
      <summary>执行结果</summary>
      <pre>{{ proposal.result }}</pre>
    </details>
  </article>
</template>
