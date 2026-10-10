<script setup lang="ts">
import type { GrowthEquipment } from '../../shared/growth';
import signal from '../assets/companion/signal.png';
// Each unlock has its own original illustration, bundled for offline use.
const props = withDefaults(defineProps<{ appearance?: GrowthEquipment['appearance']; compact?: boolean }>(), {
  appearance: 'signal',
  compact: false,
});
const images: Record<GrowthEquipment['appearance'], string> = {
  signal,
  orbit: new URL('../assets/companion/orbit.png', import.meta.url).href,
  nova: new URL('../assets/companion/nova.png', import.meta.url).href,
  atlas: new URL('../assets/companion/atlas.png', import.meta.url).href,
  observatory: new URL('../assets/companion/observatory.png', import.meta.url).href,
  aurora: new URL('../assets/companion/aurora.png', import.meta.url).href,
  voyager: new URL('../assets/companion/voyager.png', import.meta.url).href,
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
