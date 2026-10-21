<script setup lang="ts">
import { computed } from 'vue';
import { RotateCcw } from 'lucide-vue-next';
import { nextReviewState, type Review } from '../../../shared/domain';
const props = defineProps<{
  review: Review;
  busy: boolean;
  attemptResult: 'independent' | 'hint' | 'failed';
}>();
const nextDate = defineModel<string>('nextDate', { required: true });
const emit = defineEmits<{ save: [action: 'save' | 'restart'] }>();
const expected = computed(() =>
  nextReviewState(
    props.review,
    props.attemptResult,
    new Date(props.review.awaitingEvaluation?.redoAt ?? Date.now()),
  ),
);
</script>
<template>
  <section class="panel side-card">
    <span class="eyebrow">SPACED PRACTICE</span>
    <h2>理解，需要再验证</h2>
    <div class="stage-track">
      <span v-for="n in 5" :key="n" :class="{ done: n <= review.stage }">{{
        n <= review.stage ? '✓' : n
      }}</span>
    </div>
    <p class="small subtle">
      {{ review.status === 'mastered' ? '五轮独立重做已完成。' : '依次独立重做，逐步拉长复习间隔。'
      }}<br />次日 → 3 天 → 7 天 → 14 天 → 30 天
    </p>
    <p v-if="review.awaitingEvaluation" class="small">
      当天 AC 已确认重做完成；请评价是否独立做对。评价前不安排下次复习。
    </p>
    <p v-if="review.firstReflectionRequired && review.firstRedoAt && !review.firstReflectionAt" class="small">
      首次重做后，请在左侧至少填写一项分析并保存，完成今天的复盘步骤。
    </p>
    <p v-if="review.status === 'pending' && !review.firstRedoAt" class="small">
      先打开原题重做；当天 CF AC 会自动确认重做完成。未 AC 时也可记录一次尝试。
    </p>
    <label v-if="review.status === 'reviewing'">下次复习日期<input v-model="nextDate" type="date" /></label
    ><button v-if="review.status === 'reviewing'" class="wide" :disabled="busy" @click="emit('save', 'save')">
      保存日期与笔记</button
    ><button
      v-if="review.status === 'mastered'"
      class="wide"
      :disabled="busy"
      @click="emit('save', 'restart')"
    >
      <RotateCcw :size="15" />重新加入复习
    </button>
    <p v-if="review.awaitingEvaluation" class="small subtle">
      按当前评价选择，保存后{{
        expected.nextReview
          ? '预计于 ' + new Date(expected.nextReview).toLocaleDateString('zh-CN') + ' 再复习'
          : '完成第五轮独立验证'
      }}。提示帮助仍由实际记录校验。
    </p>
    <div v-if="review.ignored" class="alert">此题已忽略，不会出现在复习队列中。</div>
  </section>
</template>
