<script setup lang="ts">
import type { SyncJob } from '../../../shared/domain';
import PlatformHealthPanel from './PlatformHealthPanel.vue';
defineProps<{ atcoder: SyncJob | null }>();
</script>
<template><PlatformHealthPanel /></template>
