<script setup lang="ts">
import { computed, watch } from 'vue';
import { useSpringValues } from '../../motion';

export interface RadarSeries {
  name: string;
  color?: string;
  values: number[];
  hidden?: boolean;
}

const props = withDefaults(
  defineProps<{
    axes: string[];
    series: RadarSeries[];
    max?: number;
    labels?: boolean;
    ariaLabel?: string;
    tooltip?: (axisIndex: number) => string;
  }>(),
  { max: 100, labels: false, ariaLabel: '雷达图', tooltip: undefined },
);

const palette = ['#3f6ff0', '#f59e0b', '#ef5b5b', '#12a594'];
const colorOf = (index: number, series: RadarSeries) =>
  series.color ?? (props.series.length > 1 ? palette[index % palette.length] : 'var(--accent)');
const visible = computed(() => props.series.filter((s) => !s.hidden));
const axisCount = computed(() => Math.max(props.axes.length, 1));
// 所有系列的数值扁平化后驱动同一组弹簧，从 0 动画到目标值；新增或删除系列会改变
// 弹簧维度（setTarget 会抛错），父组件须以 :key 让本组件重新挂载。
const flatten = () => visible.value.flatMap((s) => s.values.map((v) => v || 0));
const spring = useSpringValues(flatten().map(() => 0));
watch(
  () => flatten(),
  (next) => spring.setTarget(next),
  { immediate: true },
);
const center = 160,
  radius = 110;
const point = (axis: number, r: number) => {
  const angle = -Math.PI / 2 + (axis * 2 * Math.PI) / axisCount.value;
  return { x: center + Math.cos(angle) * r, y: center + Math.sin(angle) * r };
};
const pointText = (axis: number, r: number) => {
  const p = point(axis, r);
  return `${p.x},${p.y}`;
};
const rings = computed(() =>
  [0.25, 0.5, 0.75, 1].map((scale) =>
    Array.from({ length: axisCount.value }, (_, i) => pointText(i, radius * scale)).join(' '),
  ),
);
const radiusOf = (value: number) =>
  (Math.min(Math.max(value, 0), props.max) / props.max) * radius;
const shapeOf = (seriesIndex: number) =>
  visible.value[seriesIndex]?.values
    .map((_, axis) =>
      pointText(axis, radiusOf(spring.values.value[seriesIndex * axisCount.value + axis] ?? 0)),
    )
    .join(' ') ?? '';
const dotOf = (seriesIndex: number, axis: number) =>
  point(axis, radiusOf(spring.values.value[seriesIndex * axisCount.value + axis] ?? 0));
const primaryScores = computed(() => (visible.value[0]?.values ?? []).join(','));
const labelPosition = (axis: number) => {
  const p = point(axis, radius + 18);
  const cos = Math.cos(-Math.PI / 2 + (axis * 2 * Math.PI) / axisCount.value);
  return {
    x: p.x,
    y: p.y,
    anchor: Math.abs(cos) < 0.35 ? 'middle' : cos > 0 ? 'start' : 'end',
  };
};
</script>
<template>
  <div class="radar-chart">
    <svg
      class="mastery-radar"
      viewBox="0 0 320 320"
      role="img"
      :aria-label="ariaLabel"
      :data-target-scores="primaryScores"
    >
      <polygon v-for="(ring, i) in rings" :key="i" :points="ring" class="radar-ring" />
      <line
        v-for="i in axisCount"
        :key="i"
        x1="160"
        y1="160"
        :x2="point(i - 1, radius).x"
        :y2="point(i - 1, radius).y"
        class="radar-axis"
      />
      <template v-for="(s, index) in visible" :key="s.name">
        <polygon
          :points="shapeOf(index)"
          :class="{ 'radar-value': index === 0 }"
          :style="{ fill: colorOf(index, s), stroke: colorOf(index, s) }"
          fill-opacity="0.14"
          stroke-width="2"
        />
        <circle
          v-for="(value, ai) in s.values"
          :key="ai"
          :cx="dotOf(index, ai).x"
          :cy="dotOf(index, ai).y"
          r="3"
          class="radar-dot"
          :style="{ fill: colorOf(index, s) }"
        >
          <title>{{ tooltip ? tooltip(ai) : `${s.name} · ${axes[ai]}：${value}` }}</title>
        </circle>
      </template>
      <template v-if="labels">
        <text
          v-for="(axis, i) in axes"
          :key="axis"
          class="radar-label"
          :x="labelPosition(i).x"
          :y="labelPosition(i).y"
          :text-anchor="labelPosition(i).anchor"
        >
          {{ axis }}
        </text>
      </template>
    </svg>
    <div v-if="visible.length > 1" class="radar-legend">
      <span v-for="(s, index) in visible" :key="s.name" class="radar-legend-item">
        <i :style="{ background: colorOf(index, s) }"></i>{{ s.name }}
      </span>
    </div>
  </div>
</template>
<style scoped>
.radar-chart {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.radar-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px 16px;
  font-size: 12px;
  color: var(--muted);
}
.radar-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.radar-legend-item i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.radar-label {
  font-size: 11px;
  fill: var(--muted);
}
</style>
