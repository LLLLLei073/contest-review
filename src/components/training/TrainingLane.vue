<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight, ExternalLink } from 'lucide-vue-next';
import type { TrainingDay, TrainingTask } from '../../../shared/training';
import { knowledgeCards, knowledgeFor } from '../../../shared/knowledge';
const props = defineProps<{
  lane: 'review' | 'new';
  day: TrainingDay | null;
  loading: boolean;
  planLoadingNotice: boolean;
  cf: boolean;
}>();
const emit = defineEmits<{ attempt: [task: TrainingTask] }>();
const reviewDone = computed(() => props.day?.review.filter((task) => task.completed).length ?? 0);
const newDone = computed(() => props.day?.newProblems.filter((task) => task.completed).length ?? 0);
</script>
<template>
  <section v-if="lane === 'review'" class="panel daily-panel">
    <div class="section-head">
      <div>
        <span class="eyebrow">01 / REVIEW</span>
        <h2>
          复习 <span class="count">{{ reviewDone }}/{{ day?.review.length ?? 0 }}</span>
        </h2>
        <p>到期重做优先，不足 5 题时补入待复盘错题。</p>
      </div>
      <div
        class="daily-progress"
        role="progressbar"
        aria-label="今日复习进度"
        :aria-valuenow="reviewDone"
        aria-valuemin="0"
        :aria-valuemax="day?.review.length ?? 0"
      >
        <span :style="{ transform: `scaleX(${reviewDone / Math.max(1, day?.review.length ?? 0)})` }"></span>
      </div>
    </div>
    <div v-if="loading && !day" class="quiet-empty" role="status">
      <span v-if="planLoadingNotice">正在读取今日安排…</span><span v-else aria-hidden="true">&nbsp;</span>
    </div>
    <div v-else-if="!day?.review.length" class="quiet-empty">
      今天没有到期或待复盘题目。<RouterLink to="/problems">查看错题库</RouterLink>
    </div>
    <article
      v-for="(task, index) in day?.review ?? []"
      :key="task.key"
      class="daily-task"
      :data-phase="task.phase"
    >
      <div class="daily-task-main">
        <span class="daily-number">{{ String(index + 1).padStart(2, '0') }}</span>
        <div class="daily-task-content">
          <strong>{{ task.name }}</strong>
          <div class="daily-meta">
            {{ task.source === 'atcoder' ? 'AtCoder · ' + task.key.slice(8) : task.key.replace(':', '') }}
            · {{ task.rating ?? '暂无难度' }} ·
            {{ task.tags.slice(0, 2).join(' / ') || '暂无标签' }}
          </div>
        </div>
        <Transition name="task-state" mode="out-in"
          ><span
            :key="`${task.phase}:${task.redoAccepted}:${task.completed}`"
            :class="[
              'badge',
              task.completed ? 'mastered' : task.phase === 'reflection' ? 'pending' : 'reviewing',
            ]"
            >{{
              task.phase === 'reflection'
                ? task.redoAccepted
                  ? '重做完成 · 待复盘'
                  : '已尝试 · 待复盘'
                : task.phase === 'evaluation'
                  ? '重做完成 · 待评价'
                  : task.completed
                    ? task.redoAccepted
                      ? '今日 AC'
                      : '今日已尝试'
                    : '待重做'
            }}</span
          ></Transition
        >
      </div>
      <div class="daily-actions">
        <a :href="task.url" target="_blank" rel="noreferrer" class="text-link"
          >原题 <ExternalLink :size="13"
        /></a>
        <RouterLink :to="'/problems/' + encodeURIComponent(task.key)" class="text-link"
          >{{ task.phase === 'reflection' ? '写复盘' : '查看笔记' }} <ArrowRight :size="13"
        /></RouterLink>
        <button
          v-if="task.phase === 'evaluation' || (!task.completed && task.phase !== 'reflection')"
          class="small-button"
          @click="emit('attempt', task)"
        >
          {{ task.redoAccepted ? '手动评价' : '记录尝试' }}
        </button>
      </div>
      <p v-if="task.phase === 'reflection'" class="subtle small">
        保存“当时的思路、根本原因、正确解法、复杂度分析、关键反例”中的任意一项，才算完成复盘；仅选错因或保存代码不计入。
      </p>
      <slot name="attempt" :task="task" />
    </article>
  </section>
  <section v-else class="panel daily-panel">
    <div class="section-head">
      <div>
        <span class="eyebrow">02 / DISCOVER</span>
        <h2>
          新知 <span class="count">{{ newDone }}/{{ day?.newProblems.length ?? 0 }}</span>
        </h2>
        <p>每天最多 5 道从未提交过的 CF 题，优先安排本周目标领域。</p>
      </div>
      <div
        class="daily-progress"
        role="progressbar"
        aria-label="今日新知进度"
        :aria-valuenow="newDone"
        aria-valuemin="0"
        :aria-valuemax="day?.newProblems.length ?? 0"
      >
        <span :style="{ transform: `scaleX(${newDone / Math.max(1, day?.newProblems.length ?? 0)})` }"></span>
      </div>
    </div>
    <div v-if="loading && !day" class="quiet-empty" role="status">
      <span v-if="planLoadingNotice">正在读取公开题库…</span><span v-else aria-hidden="true">&nbsp;</span>
    </div>
    <div v-else-if="!day?.catalogCount" class="quiet-empty">
      {{ cf ? '尚无完整公开题库。' : '新知题仅从 Codeforces 选择。'
      }}<RouterLink to="/settings?view=sync">请先绑定并同步 Codeforces</RouterLink>；已有数据仍可离线复习。
    </div>
    <div v-else-if="!day.weeklyGoal" class="quiet-empty">选择本周目标后生成今天的新知题单。</div>
    <div v-else-if="!day.newProblems.length" class="quiet-empty">
      {{ day.newShortage || '暂无符合条件的新题；今天不会用旧题凑数。' }}
    </div>
    <article v-for="(task, index) in day?.newProblems ?? []" :key="task.key" class="daily-task">
      <div class="daily-task-main">
        <span class="daily-number">{{ String(index + 1).padStart(2, '0') }}</span>
        <div class="daily-task-content">
          <strong>{{ task.name }}</strong>
          <div class="daily-meta">
            {{ task.key.replace(':', '') }} · {{ task.rating ?? '暂无难度' }} ·
            {{ task.tags.slice(0, 2).join(' / ') || '暂无标签' }}
          </div>
          <details v-if="task.recommendationReason" class="recommendation-detail small subtle">
            <summary>推荐原因 · 约 35 分钟</summary>
            <p>{{ task.recommendationReason }}</p>
            <p class="small subtle">
              默认估时，仅供参考。关联知识：<RouterLink
                v-for="id in knowledgeFor(task.tags).slice(0, 2)"
                :key="id"
                :to="{ path: '/knowledge', query: { card: id } }"
                >{{ knowledgeCards.find((k) => k.id === id)?.title }} </RouterLink
              ><RouterLink to="/?view=path">查看目标路径</RouterLink>
            </p>
          </details>
        </div>
        <Transition name="task-state" mode="out-in"
          ><span
            :key="`${task.completed}:${task.attempted}`"
            :class="['badge', task.completed ? 'mastered' : task.attempted ? 'pending' : 'reviewing']"
            >{{ task.completed ? '今日 AC' : task.attempted ? '已尝试' : '未尝试' }}</span
          ></Transition
        >
      </div>
      <div class="daily-actions">
        <a :href="task.url" target="_blank" rel="noreferrer" class="text-link"
          >打开原题 <ExternalLink :size="13"
        /></a>
      </div>
    </article>
    <p v-if="day && day.catalogCount && day.newProblems.length < 5" class="daily-footnote">
      {{ day.newShortage || `符合条件的候选不足 5 道，今天安排了 ${day.newProblems.length} 道。` }}
    </p>
  </section>
</template>
