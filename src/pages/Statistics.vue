<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { ChartNoAxesCombined } from 'lucide-vue-next';
import { api } from '../api';
import type { Statistics } from '../../shared/domain';
const stats = ref<Statistics | null>(null),
  error = ref('');
const maximum = computed(() =>
  Math.max(1, ...(stats.value?.trend.map((t) => t.independent + t.hint + t.failed) || [])),
);
onMounted(async () => {
  try {
    stats.value = await api('/statistics');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>
<template>
  <div class="page-head">
    <div>
      <div class="eyebrow">PROGRESS, NOT PERFECTION</div>
      <h1>训练统计</h1>
      <p>找到反复出现的问题，让下一次练习更有方向。</p>
    </div>
    <span class="date-chip"><ChartNoAxesCombined :size="17" />按唯一题目统计</span>
  </div>
  <div v-if="error" class="alert error">{{ error }}</div>
  <template v-if="stats"
    ><div class="metrics">
      <div class="metric">
        <span>累计错题</span><strong>{{ stats.total }}<small>题</small></strong>
        <p>不含已忽略题目</p>
      </div>
      <div class="metric">
        <span>尚未 AC</span><strong>{{ stats.unsolved }}<small>题</small></strong>
        <p>等待解决的难点</p>
      </div>
      <div class="metric">
        <span>已经掌握</span><strong>{{ stats.mastered }}<small>题</small></strong>
        <p>完成五轮独立重做</p>
      </div>
      <div class="metric accent">
        <span>同步提交总数</span><strong>{{ stats.submissions }}<small>次</small></strong>
        <p>包括成功与失败的全部提交</p>
      </div>
    </div>
    <section class="panel trend-panel">
      <div class="section-head">
        <div>
          <span class="eyebrow">CONSISTENCY MATTERS</span>
          <h2>最近 14 天的重做记录</h2>
        </div>
        <div class="legend">
          <span><i class="independent"></i>独立做对</span><span><i class="hint"></i>借助提示</span
          ><span><i class="failed"></i>仍未做出</span>
        </div>
      </div>
      <div class="trend-chart" role="img" aria-label="最近十四天重做结果柱状图">
        <div v-for="t in stats.trend" :key="t.date" class="chart-column">
          <span class="chart-value">{{ t.independent + t.hint + t.failed || '' }}</span>
          <div class="bar-area">
            <div
              class="bar-stack"
              :title="`${t.date}：独立做对 ${t.independent}，借助提示 ${t.hint}，仍未做出 ${t.failed}`"
            >
              <div class="failed" :style="{ height: (t.failed / maximum) * 160 + 'px' }"></div>
              <div class="hint" :style="{ height: (t.hint / maximum) * 160 + 'px' }"></div>
              <div class="independent" :style="{ height: (t.independent / maximum) * 160 + 'px' }"></div>
            </div>
          </div>
          <span class="chart-date">{{ t.date.slice(5).replace('-', '/') }}</span>
        </div>
      </div>
      <p class="chart-caption">每次重做计为一条记录，按本地日期归集。没有记录的日期显示为零。</p>
    </section>
    <div class="two-columns">
      <section
        v-for="group in [
          { title: '常见错因', sub: '从错误中找到模式', rows: stats.reasons },
          { title: '算法分布', sub: '你的错题集中在哪些领域', rows: stats.tags },
        ]"
        :key="group.title"
        class="panel distribution"
      >
        <div class="section-head">
          <div>
            <h2>{{ group.title }}</h2>
            <p>{{ group.sub }}</p>
          </div>
        </div>
        <div v-if="!group.rows.length" class="quiet-empty">暂无数据，完成导入并填写错因后查看。</div>
        <div v-for="([label, count], i) in group.rows.slice(0, 12)" :key="label" class="distribution-row">
          <span class="row-number">{{ String(i + 1).padStart(2, '0') }}</span>
          <div>
            <div class="distribution-label">
              <span>{{ label }}</span
              ><b>{{ count }} <small>题</small></b>
            </div>
            <div class="horizontal-track">
              <span :style="{ width: (count / Math.max(1, group.rows[0][1])) * 100 + '%' }"></span>
            </div>
          </div>
        </div>
        <p class="chart-caption">一道题可含多个分类，因此各项之和可能大于题目总数。</p>
      </section>
    </div></template
  >
</template>
