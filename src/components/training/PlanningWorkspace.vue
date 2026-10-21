<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue';
import { api, dataRevision, settings } from '../../api';
import { knowledgeCards } from '../../../shared/knowledge';
import { localDay } from '../../../shared/core-store';
import {
  planningStateSchema,
  planDecisionSchema,
  type PlanningState,
  type PlanDecision,
} from '../../../shared/planning-domain';
import LearningPath from './LearningPath.vue';
import PlanPreview from './PlanPreview.vue';
const props = defineProps<{ mode: 'path' | 'plan' | 'knowledge' }>();
const state = ref<PlanningState>(),
  decision = ref<PlanDecision>();
const error = ref(''),
  message = ref(''),
  loading = ref(false),
  busy = ref(false),
  budget = ref<number | null>(null),
  targets = ref<string[]>([]);
const date = ref(localDay(new Date(Date.now() + 86400000)));
const tomorrow = computed(() => localDay(new Date(Date.now() + 86400000)));
const maxDate = computed(() => localDay(new Date(Date.now() + 30 * 86400000)));
const configured = computed(() => !!settings.value.activeHandle || !!settings.value.activeAtcoder);
const goalCategories = computed(() => [
  ...new Set(knowledgeCards.filter((k) => targets.value.includes(k.id)).map((k) => k.category)),
]);
let alive = true,
  serial = 0,
  initialized = false;
onScopeDispose(() => {
  alive = false;
  serial++;
});
const owner = () => `${settings.value.activeHandle}:${settings.value.activeAtcoder}`;
async function load() {
  if (!configured.value) return;
  const request = ++serial,
    scope = owner();
  loading.value = true;
  error.value = '';
  try {
    const next = planningStateSchema.parse(await api('/planning/state'));
    if (!alive || request !== serial || scope !== owner()) return;
    state.value = next;
    if (!initialized) {
      budget.value = next.options.budget;
      targets.value = [...next.options.targets];
      initialized = true;
    }
    if (decision.value) decision.value = next.decisions.find((d) => d.id === decision.value!.id);
  } catch (e) {
    if (alive && request === serial) error.value = (e as Error).message;
  } finally {
    if (alive && request === serial) loading.value = false;
  }
}
async function run(
  action: 'preferences' | 'preview' | 'apply' | 'revert' | 'goal',
  excludeKeys: string[] = [],
) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  message.value = '';
  const scope = owner();
  try {
    if (action === 'goal') {
      await api('/planning/goal', {
        date: date.value,
        mode: goalCategories.value.length === 1 ? 'focus' : 'balanced',
        categories: goalCategories.value,
      });
      if (!alive || scope !== owner()) return;
      decision.value = undefined;
      message.value = '已设置计划所在周的训练领域；既有今日题单保持固定';
      await load();
    } else if (action === 'preferences') {
      const next = planningStateSchema.parse(
        await api('/planning/state', { budget: budget.value, targets: targets.value }, 'PUT'),
      );
      if (alive && scope === owner()) {
        state.value = next;
        decision.value = undefined;
        message.value = '学习方向与时间偏好已保存';
      }
    } else {
      const input =
        action === 'preview'
          ? { date: date.value, budget: budget.value, targets: targets.value, excludeKeys }
          : { id: decision.value?.id };
      const next = planDecisionSchema.parse(await api('/planning/' + action, input));
      if (!alive || scope !== owner()) return;
      decision.value = next;
      message.value =
        action === 'apply'
          ? '未来计划已采用'
          : action === 'revert'
            ? '已恢复变更前的安排'
            : '预览已生成，确认后生效';
      await load();
    }
  } catch (e) {
    if (alive && scope === owner()) error.value = (e as Error).message;
  } finally {
    if (alive) busy.value = false;
  }
}
onMounted(() => void load());
watch(dataRevision, () => {
  if (state.value && !busy.value) void load();
});
watch(owner, () => {
  serial++;
  initialized = false;
  state.value = undefined;
  decision.value = undefined;
  budget.value = null;
  targets.value = [];
  void load();
});
</script>
<template>
  <div class="planning-workspace">
    <p v-if="!configured" class="quiet-empty">
      连接训练账号后，即可根据真实记录建立学习路径。<RouterLink to="/settings?view=accounts"
        >连接账号</RouterLink
      >
    </p>
    <p v-if="loading && !state" role="status" class="quiet-empty">正在整理学习证据…</p>
    <div v-if="error" role="alert" class="alert error">
      {{ error }}<button :disabled="busy" @click="load">刷新数据</button>
    </div>
    <p v-if="message" role="status">{{ message }}</p>
    <template v-if="state">
      <section v-if="mode !== 'knowledge'" class="panel planning-options">
        <span class="eyebrow">LEARN WITH INTENTION</span>
        <h2>{{ mode === 'path' ? '设定学习方向' : '为下一次训练留出时间' }}</h2>
        <p class="subtle">
          本地算法结合先修关系和真实训练证据安排任务，无需配置 AI。修改只作用于确认后的未来计划。
        </p>
        <div class="planning-fields">
          <label>计划日期<input v-model="date" type="date" :min="tomorrow" :max="maxDate" /></label
          ><label
            >每天可用时间<select v-model="budget">
              <option :value="null">按题量安排</option>
              <option v-for="minutes in [15, 30, 45, 60, 90, 120, 180, 240]" :key="minutes" :value="minutes">
                {{ minutes }} 分钟
              </option>
            </select></label
          >
        </div>
        <details :open="mode === 'path'">
          <summary>目标知识点 · 已选 {{ targets.length }} 个</summary>
          <div class="knowledge-choices">
            <label v-for="card in knowledgeCards" :key="card.id"
              ><input v-model="targets" type="checkbox" :value="card.id" />{{ card.title }}</label
            >
          </div>
        </details>
        <div class="button-row">
          <button :disabled="busy" @click="run('preferences')">保存学习方向与时间</button
          ><button class="primary" :disabled="busy" @click="run('preview')">
            {{ busy ? '正在处理…' : '预览未来计划' }}
          </button>
        </div>
        <p v-if="settings.activeHandle && goalCategories.length" class="small subtle">
          计划周的领域可设为：{{ goalCategories.join('、') }}。跨周安排时，需要为新一周单独选定领域。
        </p>
        <button
          v-if="settings.activeHandle && goalCategories.length"
          class="small-button"
          :disabled="busy"
          @click="run('goal')"
        >
          将所选领域用于计划所在周
        </button>
      </section>
      <PlanPreview
        v-if="decision"
        :decision="decision"
        :busy="busy"
        @apply="run('apply')"
        @revert="run('revert')"
        @replace="(key) => run('preview', [...decision!.request.excludeKeys, key])"
      />
      <LearningPath
        v-if="mode === 'path'"
        :path="decision?.path ?? state.path"
        :tracing="state.tracing"
        :evidence="state.evidence"
      />
      <section v-if="mode === 'knowledge' || mode === 'path'" class="panel knowledge-estimates">
        <h2>知识状态与证据</h2>
        <p class="subtle">
          概率是未校准的推荐信号；独立验证来自明确评价和对应 AC。样本不足时不显示能力百分比。
        </p>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>知识点</th>
                <th>观察题数</th>
                <th>独立验证</th>
                <th>推荐信号</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="skill in state.tracing.states" :key="skill.skillId">
                <td>
                  <RouterLink :to="'/knowledge?card=' + skill.skillId">{{
                    knowledgeCards.find((k) => k.id === skill.skillId)?.title
                  }}</RouterLink>
                </td>
                <td>{{ skill.distinctProblems }}</td>
                <td>{{ skill.independentProblems }} 题</td>
                <td>
                  {{ skill.insufficient ? '样本不足' : Math.round(skill.probability * 100) + '%（估计）' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="small subtle">
          {{ state.tracing.excluded.length }} 条观察因提示、归因、重复或验证不足而未纳入单技能估计。{{
            state.tracing.version
          }}
        </p>
      </section>
      <details v-if="state.decisions.length" class="panel planning-history">
        <summary>计划历史 · {{ state.decisions.length }} 个版本</summary>
        <div v-for="item in state.decisions" :key="item.id" class="history-row">
          <span
            >{{ item.request.date }} ·
            {{ { preview: '待确认', applied: '已采纳', reverted: '已撤回', expired: '已失效' }[item.status] }}
            · {{ item.result.allocatedMinutes }} 分钟</span
          ><button class="small-button" @click="decision = item">查看版本</button>
        </div>
      </details>
      <details v-if="mode === 'path' && state.paths.length > 1" class="panel planning-history">
        <summary>查看原路径与目标变化</summary>
        <p v-for="path in state.paths" :key="path.id">
          {{ new Date(path.createdAt).toLocaleString('zh-CN') }} ·
          {{ path.path.nodes.map((n) => n.title).join(' → ') || '未指定目标' }}
        </p>
      </details>
      <section class="panel planning-history">
        <h2>规划后的实际训练</h2>
        <p v-if="state.followup" class="small">
          当前逾期复习 {{ state.followup.overdue }} 题 · 迁移独立完成
          {{ state.followup.transferIndependent }} / 已评价 {{ state.followup.transferEvaluated }} ·
          迁移待验证 {{ state.followup.transferPending }}。这些是当前账号整体状态，不能全部归因于新规划。
        </p>
        <p class="small subtle">
          只统计已采纳计划的当日评价与用户记录用时。独立完成还需匹配个人 AC
          且没有提示；缺少评价不当作失败，缺少用时不补估值。这里是观察数据，不能证明算法带来了学习提升。
        </p>
        <p v-if="!state.outcomes.length" class="quiet-empty">
          尚无已采纳计划的后续记录。积累训练后可比较预估和实际用时。
        </p>
        <div v-else class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>已评价 / 安排</th>
                <th>可核验独立完成</th>
                <th>提示依赖</th>
                <th>每小时独立完成</th>
                <th>记录用时</th>
                <th>计划估时</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in state.outcomes" :key="item.id">
                <td>{{ item.date }} {{ item.elapsed ? '' : '· 尚未开始' }}</td>
                <td>{{ item.evaluated }} / {{ item.assigned }}</td>
                <td>{{ item.independent }}</td>
                <td>{{ item.hint }} / {{ item.evaluated }}</td>
                <td>
                  {{
                    item.independentPerHour === null ? '用时不足' : item.independentPerHour.toFixed(2) + ' 题'
                  }}
                </td>
                <td>
                  {{ item.timed ? item.minutes + ' 分钟' : '缺少用时' }} · {{ item.timed }}/{{
                    item.attempts
                  }}
                  次有用时
                </td>
                <td>{{ item.estimatedMinutes }} 分钟</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
<style scoped>
.planning-workspace {
  display: grid;
  gap: 20px;
}
.planning-options,
.knowledge-estimates,
.planning-history {
  padding: 24px;
}
.planning-options h2 {
  margin: 10px 0;
}
.planning-fields {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  margin: 24px 0;
}
.planning-fields label {
  display: grid;
  gap: 8px;
  font-size: 13px;
}
.planning-fields input,
.planning-fields select {
  min-width: 180px;
  padding: 10px;
}
.knowledge-choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin: 20px 0;
}
.knowledge-choices label {
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  min-height: 36px;
  text-align: left;
}
.knowledge-choices input[type='checkbox'] {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  margin: 0;
}
.planning-options > .button-row {
  margin-top: 24px;
}
.table-scroll {
  overflow: auto;
}
.table-scroll table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
}
.table-scroll th,
.table-scroll td {
  padding: 12px 8px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
.table-scroll th {
  font-size: 11px;
  color: var(--muted);
}
.history-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.planning-history p {
  font-size: 13px;
  line-height: 1.8;
}
@media (max-width: 500px) {
  .knowledge-choices {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .planning-options,
  .knowledge-estimates,
  .planning-history {
    padding: 18px;
  }
  .planning-fields {
    gap: 12px;
  }
  .planning-fields label {
    flex: 1;
  }
  .planning-fields input,
  .planning-fields select {
    min-width: 0;
    width: 100%;
  }
  .history-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
