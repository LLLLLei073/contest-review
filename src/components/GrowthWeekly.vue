<script setup lang="ts">
import {growth} from '../growth';
</script>
<template>
  <section v-if="growth" class="growth-weekly panel" aria-label="目标领域周任务">
    <div class="section-head"><div><span class="eyebrow">WEEKLY / 目标领域</span><h2>本周研习任务</h2></div><strong>{{growth.weekly.earned}} / 180 EXP</strong></div>
    <template v-if="growth.weekly.goal">
      <p class="small subtle">{{growth.weekly.week}} 起 · 奖励目标已固定：{{growth.weekly.goal.categories.join('、')}}。本周修改训练目标不会重置奖励。</p>
      <div class="weekly-growth-grid"><article v-for="task in growth.weekly.tasks" :key="task.id" class="weekly-growth-task" :class="{complete:task.complete}">
        <div class="section-head"><h3>{{task.title}}</h3><strong>+{{task.xp}} EXP</strong></div>
        <p>{{task.id==='breakthrough'?'首次 AC 或有效独立重做':task.id==='independent'?'有效独立重做':'首次有效复盘'}} {{task.target}} 道不同题目</p>
        <div class="achievement-track" role="progressbar" :aria-label="task.title+'进度'" :aria-valuenow="Math.min(task.target,task.progress)" :aria-valuemin="0" :aria-valuemax="task.target"><span :style="{width:Math.min(100,task.progress/task.target*100)+'%'}"></span></div>
        <p class="small">{{Math.min(task.target,task.progress)}} / {{task.target}} 题<span v-if="task.coverageTarget>1"> · 领域覆盖 {{Math.min(task.coverageTarget,task.coverage.length)}} / {{task.coverageTarget}}</span></p>
        <p class="weekly-task-status">{{task.complete?'已达标 · 经验自动计入':'还需 '+Math.max(0,task.target-task.progress)+' 题'+(task.coverage.length<task.coverageTarget?'，补齐目标领域覆盖':'')}}</p>
        <details v-if="task.evidence.length"><summary>查看学习依据</summary><ul><li v-for="event in task.evidence" :key="event.id"><RouterLink v-if="event.canReview" :to="'/problems/'+encodeURIComponent(event.problemKey)">{{event.title}}</RouterLink><a v-else-if="event.url" :href="event.url" target="_blank" rel="noreferrer">{{event.title}} ↗</a><span v-else>{{event.title}}</span> · {{event.day}}</li></ul></details>
      </article></div>
      <p class="small subtle">从启用当周起按北京时间计算，不补往年奖励。任务沿用已有题目，候选不足不降低要求。</p>
      <p v-if="growth.weekly.unclassified" class="small">本周有 {{growth.weekly.unclassified}} 道题目缺少领域标注，暂未计入目标任务；可在错题详情补充 AtCoder 领域。</p>
      <div class="weekly-growth-links"><RouterLink to="/">查看今日训练 →</RouterLink><RouterLink to="/problems">查看错题与复盘 →</RouterLink></div>
    </template>
    <div v-else class="quiet-empty">选择本周算法目标后开启三项研习任务。<RouterLink to="/">前往今日训练选择目标 →</RouterLink></div>
  </section>
</template>
