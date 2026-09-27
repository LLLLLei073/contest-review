<script setup lang="ts">
import { ArrowUpRight } from 'lucide-vue-next';
import type { ProblemRow } from '../../shared/domain';
import { dateLabel, statusLabels } from '../api';
defineProps<{ items: ProblemRow[] }>();
</script>
<template>
  <div class="table-wrap">
    <table class="problem-table">
      <thead>
        <tr>
          <th>题目 / 算法</th>
          <th>难度</th>
          <th>提交表现</th>
          <th>复盘状态</th>
          <th>下次复习</th>
          <th><span class="sr-only">打开</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in items" :key="p.key">
          <td>
            <RouterLink class="problem-name" :to="'/problems/' + encodeURIComponent(p.key)"
              ><span class="problem-index">{{
                p.source === 'atcoder' ? 'AtCoder · ' + p.index : p.contestId + p.index
              }}</span
              >{{ p.name }}</RouterLink
            >
            <div class="tag-line">
              <span
                v-for="tag in (p.source === 'atcoder' ? p.review.categories : p.tags).slice(0, 3)"
                :key="tag"
                >{{ tag }}</span
              ><span v-if="!(p.source === 'atcoder' ? p.review.categories : p.tags).length">暂无标签</span>
            </div>
          </td>
          <td>
            <span class="rating">{{ p.rating ?? '—' }}</span
            ><small v-if="p.source === 'atcoder'" class="subtle"> 估计难度</small>
          </td>
          <td>
            <span :class="['solve-label', p.solved ? 'solved' : '']">{{ p.solved ? '已 AC' : '未 AC' }}</span
            ><span class="subtle small"> · {{ p.failures }} 次失败</span>
          </td>
          <td>
            <span :class="['badge', p.review.status]">{{
              p.review.ignored ? '已忽略' : statusLabels[p.review.status]
            }}</span>
          </td>
          <td class="mono subtle">{{ dateLabel(p.review.nextReview) }}</td>
          <td>
            <RouterLink :to="'/problems/' + encodeURIComponent(p.key)" :aria-label="'复盘 ' + p.name"
              ><ArrowUpRight :size="17"
            /></RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
