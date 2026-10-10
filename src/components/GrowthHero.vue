<script setup lang="ts">
import { computed } from 'vue';
import { ArrowUpRight, Sparkles, Trophy } from 'lucide-vue-next';
import { growth, growthError, refreshGrowth } from '../growth';
import Companion from './Companion.vue';
const progress = computed(() =>
  growth.value
    ? ((growth.value.xp - growth.value.levelStart) / (growth.value.nextLevel - growth.value.levelStart)) * 100
    : 0,
);
</script>
<template>
  <section class="growth-hero" aria-label="学习成长">
    <div class="growth-hero__content">
      <div class="terminal-tag"><span class="signal-dot"></span> TRAINING TERMINAL <span>/ 01</span></div>
      <h2>每一次回解，<br /><span>都让思路向前。</span></h2>
      <p class="growth-hero__message">星澪已就位。今天，也一起把未知变成理解。</p>
      <template v-if="growth">
        <div class="growth-hero__status">
          <span class="level-mark">Lv.{{ growth.level }}</span
          ><span>{{ growth.xp }} <small>EXP</small></span
          ><RouterLink class="astra-hero-link" to="/companion"
            >星澪对话 <ArrowUpRight :size="14" /></RouterLink
          ><RouterLink to="/growth">成长收藏 <ArrowUpRight :size="15" /></RouterLink>
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
        <div class="xp-caption">
          <span>学习成长 · 与掌握度分别记录</span
          ><span>{{ growth.xp - growth.levelStart }} / {{ growth.nextLevel - growth.levelStart }}</span>
        </div>
        <div class="hero-achievements">
          <Trophy :size="14" /><span v-if="growth.nextStage" class="next-growth-condition"
            >{{ growth.nextStage.name }} · {{ growth.nextStage.conditions.find((c) => !c.met)?.label }}
            {{ growth.nextStage.conditions.find((c) => !c.met)?.progress }} /
            {{ growth.nextStage.conditions.find((c) => !c.met)?.target }}</span
          ><span>{{
            growth.achievements
              .filter((a) => a.unlocked)
              .slice(-2)
              .map((a) => a.title)
              .join(' / ') || '完成真实训练，点亮第一枚成就'
          }}</span>
        </div>
      </template>
      <div v-else-if="growthError" class="alert error" role="alert">
        {{ growthError }}<button @click="refreshGrowth">重试</button>
      </div>
      <p v-else role="status">正在读取成长记录…</p>
    </div>
    <div class="growth-hero__art">
      <div class="orbital-ring"></div>
      <Companion :appearance="growth?.equipment.appearance" /><span class="companion-name"
        ><Sparkles :size="13" /> 星澪 <small>ASTRA / LEARNING COMPANION</small></span
      >
    </div>
    <div class="growth-hero__coordinate" aria-hidden="true">SYNC YOUR UNDERSTANDING. // 回解</div>
  </section>
</template>
