<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Check, LockKeyhole, Trophy, ChevronLeft, ChevronRight, Orbit } from 'lucide-vue-next';
import { api, settings, dataRevision } from '../api';
import {
  growth,
  growthError,
  refreshGrowth,
  equipGrowth,
  growthKindLabel,
  type GrowthHistory,
} from '../growth';
import { growthCosmetics, type GrowthEquipment } from '../../shared/growth-domain';
import Companion from '../components/Companion.vue';
const history = ref<GrowthHistory | null>(null),
  page = ref(1),
  error = ref(''),
  busy = ref(false),
  historyLoading = ref(false);
let request = 0;
const progress = computed(() =>
  growth.value
    ? ((growth.value.xp - growth.value.levelStart) / (growth.value.nextLevel - growth.value.levelStart)) * 100
    : 0,
);
async function loadHistory() {
  const read = ++request;
  const scope = `${settings.value.activeHandle}|${settings.value.activeAtcoder || ''}|${dataRevision.value}`;
  const isCurrent = () =>
    read === request &&
    scope === `${settings.value.activeHandle}|${settings.value.activeAtcoder || ''}|${dataRevision.value}`;
  historyLoading.value = true;
  history.value = null;
  try {
    const next = await api<GrowthHistory>(`/growth/history?page=${page.value}&pageSize=20`);
    if (isCurrent()) {
      history.value = next;
      error.value = '';
    }
  } catch (e) {
    if (isCurrent()) error.value = (e as Error).message;
  } finally {
    if (isCurrent()) historyLoading.value = false;
  }
}
async function equip(type: 'appearance' | 'palette', value: string) {
  if (!growth.value) return;
  busy.value = true;
  try {
    await equipGrowth({ ...growth.value.equipment, [type]: value } as GrowthEquipment);
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
watch(page, loadHistory);
watch(
  () => `${settings.value.activeHandle}|${settings.value.activeAtcoder || ''}|${dataRevision.value}`,
  () => {
    if (page.value !== 1) page.value = 1;
    else void loadHistory();
  },
);
onMounted(() => {
  void refreshGrowth();
  void loadHistory();
});
onBeforeUnmount(() => {
  request++;
});
</script>
<template>
  <div class="page-head">
    <div>
      <div class="eyebrow">PERSONAL ARCHIVE / 成长档案</div>
      <h1>成长收藏</h1>
      <p>记录真实学习的足迹，解锁属于你的终端。</p>
    </div>
    <Orbit :size="30" class="growth-heading-icon" />
  </div>
  <div v-if="error || growthError" class="alert error" role="alert">
    {{ error || growthError
    }}<button
      @click="
        refreshGrowth();
        loadHistory();
      "
    >
      重试
    </button>
  </div>
  <template v-if="growth">
    <section class="growth-profile panel">
      <div class="growth-profile__art">
        <div class="orbital-ring"></div>
        <Companion :appearance="growth.equipment.appearance" /><span class="companion-name"
          >星澪 / ASTRA</span
        >
      </div>
      <div class="growth-profile__info">
        <div class="terminal-tag">
          YOUR JOURNEY / {{ growth.profiles.length ? '已连接训练档案' : '等待连接' }}
        </div>
        <h2>把每一次卡住，<br />变成下一次的思路。</h2>
        <div class="growth-level">
          <strong>Lv.{{ growth.level }}</strong
          ><span>{{ growth.xp }} EXP</span>
        </div>
        <div
          class="xp-track"
          role="progressbar"
          aria-label="当前等级经验"
          :aria-valuenow="growth.xp - growth.levelStart"
          :aria-valuemin="0"
          :aria-valuemax="growth.nextLevel - growth.levelStart"
        >
          <span :style="{ width: progress + '%' }"></span>
        </div>
        <p class="xp-caption">距离 Lv.{{ growth.level + 1 }} 还需 {{ growth.nextLevel - growth.xp }} 经验</p>
        <div class="growth-counts">
          <span
            ><b>{{ growth.counts.ac }}</b> 首次 AC</span
          ><span
            ><b>{{ growth.counts.independent }}</b> 独立重做</span
          ><span
            ><b>{{ growth.counts.reflection }}</b> 有效复盘</span
          ><span
            ><b>{{ growth.counts.days }}</b> 训练天数</span
          >
        </div>
        <p class="small subtle">成长等级记录学习投入；算法掌握度仍以现有学习证据评估。</p>
        <RouterLink v-if="!growth.profiles.length" to="/settings?view=accounts" class="button primary"
          >绑定训练账号</RouterLink
        >
      </div>
    </section>
    <section class="growth-section">
      <div class="section-heading">
        <span class="eyebrow">01 / COLLECTION</span>
        <h2>终端与伙伴</h2>
        <span class="small subtle">Lv.3 / Lv.5 解锁新收藏</span>
      </div>
      <div class="cosmetic-grid">
        <article
          v-for="item in growthCosmetics"
          :key="item.appearance"
          class="cosmetic-card"
          :class="{ locked: growth.level < item.level }"
        >
          <div class="cosmetic-card__art" :data-preview-palette="item.palette">
            <Companion :appearance="item.appearance" /><span class="cosmetic-card__number"
              >0{{ item.level === 1 ? 1 : item.level === 3 ? 2 : 3 }}</span
            ><span v-if="growth.level < item.level" class="cosmetic-lock"
              ><LockKeyhole :size="14" /> Lv.{{ item.level }}</span
            >
          </div>
          <div class="cosmetic-card__info">
            <span class="eyebrow">{{ item.subtitle }}</span>
            <h3>{{ item.name }}</h3>
            <div class="cosmetic-actions">
              <button
                :disabled="
                  busy ||
                  !growth.profiles.length ||
                  growth.level < item.level ||
                  growth.equipment.appearance === item.appearance
                "
                @click="equip('appearance', item.appearance)"
              >
                <Check v-if="growth.equipment.appearance === item.appearance" :size="14" />{{
                  growth.equipment.appearance === item.appearance ? '外观已装备' : '装备外观'
                }}</button
              ><button
                :disabled="
                  busy ||
                  !growth.profiles.length ||
                  growth.level < item.level ||
                  growth.equipment.palette === item.palette
                "
                @click="equip('palette', item.palette)"
              >
                {{ growth.equipment.palette === item.palette ? '配色已应用' : '应用配色' }}
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
    <section class="growth-section">
      <div class="section-heading">
        <span class="eyebrow">02 / ACHIEVEMENTS</span>
        <h2>学习成就</h2>
        <span class="small subtle"
          >{{ growth.achievements.filter((a) => a.unlocked).length }} /
          {{ growth.achievements.length }} 已点亮</span
        >
      </div>
      <div class="achievement-grid">
        <article
          v-for="a in growth.achievements"
          :key="a.id"
          class="achievement-card"
          :class="{ unlocked: a.unlocked }"
        >
          <div class="achievement-icon">
            <Trophy v-if="a.unlocked" :size="21" /><LockKeyhole v-else :size="19" />
          </div>
          <div>
            <h3>{{ a.title }}</h3>
            <p>{{ a.description }}</p>
            <div class="achievement-track">
              <span :style="{ width: Math.min(100, (a.progress / a.target) * 100) + '%' }"></span>
            </div>
            <span class="small"
              >{{ Math.min(a.progress, a.target) }} / {{ a.target }} ·
              {{ a.unlocked ? '已解锁' : '进行中' }}</span
            >
          </div>
        </article>
      </div>
    </section>
  </template>
  <p v-else-if="!growthError" role="status">正在读取成长档案…</p>
  <section class="growth-section panel growth-history">
    <div class="section-head">
      <div>
        <span class="eyebrow">03 / EVIDENCE LOG</span>
        <h2>经验来源</h2>
      </div>
      <span class="small subtle">北京时间</span>
    </div>
    <p class="growth-rules">
      首次 AC +20 · 独立重做 +30 · 借助提示 +10 · 首次有效复盘 +15。首次 AC
      当日不叠加重做奖励；同题同日取最高奖励。缺少可靠时间的历史记录不补奖。
    </p>
    <div v-if="historyLoading" class="quiet-empty" role="status">正在读取经验记录…</div>
    <div v-else-if="!history?.items.length" class="quiet-empty">
      还没有可核验的成长记录。完成训练后，足迹会出现在这里。
    </div>
    <ol v-else class="growth-event-list">
      <li v-for="event in history.items" :key="event.id">
        <div>
          <span class="event-kind">{{ growthKindLabel[event.kind] }}</span
          ><RouterLink v-if="event.canReview" :to="'/problems/' + encodeURIComponent(event.problemKey)">{{
            event.title
          }}</RouterLink
          ><a v-else-if="event.url" :href="event.url" target="_blank" rel="noreferrer">{{ event.title }} ↗</a
          ><span v-else>{{ event.title }}</span
          ><small>{{ event.profile.replace(/^ac~/, 'AtCoder · ') }} · {{ event.day }}</small>
        </div>
        <strong>+{{ event.xp }} <small>EXP</small></strong>
      </li>
    </ol>
    <div v-if="history && history.total > 20" class="growth-pagination">
      <button :disabled="page === 1 || historyLoading" aria-label="上一页经验记录" @click="page--">
        <ChevronLeft :size="16" /></button
      ><span>{{ page }} / {{ Math.ceil(history.total / 20) }}</span
      ><button
        :disabled="page * 20 >= history.total || historyLoading"
        aria-label="下一页经验记录"
        @click="page++"
      >
        <ChevronRight :size="16" />
      </button>
    </div>
  </section>
</template>
