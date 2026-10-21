<script setup lang="ts">
import { Search } from 'lucide-vue-next';
defineProps<{ years: string[]; statuses: string[]; count: number; page: number; pageCount: number }>();
const query = defineModel<string>('query', { required: true });
const source = defineModel<string>('source', { required: true });
const year = defineModel<string>('year', { required: true });
const type = defineModel<string>('type', { required: true });
const status = defineModel<string>('status', { required: true });
</script>
<template>
  <div class="contest-filters">
    <div class="filter-top">
      <label class="search-field"
        ><Search :size="17" /><input v-model="query" aria-label="搜索比赛" placeholder="搜索比赛名称或编号"
      /></label>
    </div>
    <div class="contest-source-tabs" role="group" aria-label="比赛平台">
      <button
        v-for="item in [
          { value: 'all', label: '全部' },
          { value: 'cf', label: 'CF' },
          { value: 'atcoder', label: 'AtCoder' },
          { value: 'xcpc', label: 'XCPC' },
        ]"
        :key="item.value"
        type="button"
        :aria-pressed="source === item.value"
        :class="{ active: source === item.value }"
        @click="source = item.value"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="contest-filter contest-filter-grid">
      <select v-model="year" aria-label="比赛年份">
        <option value="all">所有年份</option>
        <option v-for="item in years" :key="item" :value="item">
          {{ item === 'unknown' ? '时间待补全' : item + ' 年' }}
        </option>
      </select>
      <select v-model="type" aria-label="参赛类型">
        <option value="all">所有类型</option>
        <option value="CONTESTANT">正式参赛</option>
        <option value="VIRTUAL">虚拟参赛</option>
        <option value="practice">仅练习 / 无参赛记录</option>
      </select>
    </div>
    <p class="contest-result-count" aria-live="polite">
      <label
        >报告状态<select v-model="status">
          <option value="all">全部状态</option>
          <option v-for="item in statuses" :key="item">
            {{ item }}
          </option>
        </select></label
      >
      找到 {{ count }} 场<span v-if="count"> · 第 {{ page }} / {{ pageCount }} 页</span>
    </p>
  </div>
</template>
