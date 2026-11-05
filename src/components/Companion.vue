<script setup lang="ts">
import type { GrowthEquipment } from '../../shared/growth';
import signal from '../assets/companion/signal.webp';
import signalCompact from '../assets/companion/signal.compact.webp';
// Each unlock has its own original illustration, bundled for offline use.
// 图片分两档（720×1080 主图 / 160×240 头像），按实际显示尺寸取用，见
// scripts/build-companion-webp.mjs 的分档说明。
const props = withDefaults(defineProps<{ appearance?: GrowthEquipment['appearance']; compact?: boolean }>(), {
  appearance: 'signal',
  compact: false,
});
const images: Record<GrowthEquipment['appearance'], string> = {
  signal,
  orbit: new URL('../assets/companion/orbit.webp', import.meta.url).href,
  nova: new URL('../assets/companion/nova.webp', import.meta.url).href,
  atlas: new URL('../assets/companion/atlas.webp', import.meta.url).href,
  observatory: new URL('../assets/companion/observatory.webp', import.meta.url).href,
  aurora: new URL('../assets/companion/aurora.webp', import.meta.url).href,
  voyager: new URL('../assets/companion/voyager.webp', import.meta.url).href,
};
const compactImages: Record<GrowthEquipment['appearance'], string> = {
  signal: signalCompact,
  orbit: new URL('../assets/companion/orbit.compact.webp', import.meta.url).href,
  nova: new URL('../assets/companion/nova.compact.webp', import.meta.url).href,
  atlas: new URL('../assets/companion/atlas.compact.webp', import.meta.url).href,
  observatory: new URL('../assets/companion/observatory.compact.webp', import.meta.url).href,
  aurora: new URL('../assets/companion/aurora.compact.webp', import.meta.url).href,
  voyager: new URL('../assets/companion/voyager.compact.webp', import.meta.url).href,
};
</script>
<template>
  <div class="companion" :class="{ 'companion--compact': compact }">
    <img
      :src="props.compact ? compactImages[props.appearance] : images[props.appearance]"
      alt="原创学习伙伴星澪"
      :width="compact ? 80 : 360"
      :height="compact ? 80 : 540"
    />
  </div>
</template>
