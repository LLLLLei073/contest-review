<script setup lang="ts">
import type { GrowthEquipment } from '../../shared/growth';
import signal from '../assets/companion/signal.webp';
// Each unlock has its own original illustration, bundled for offline use.
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
</script>
<template>
  <div class="companion" :class="{ 'companion--compact': compact }">
    <img
      :src="images[props.appearance]"
      alt="原创学习伙伴星澪"
      :width="compact ? 80 : 360"
      :height="compact ? 80 : 540"
    />
  </div>
</template>
