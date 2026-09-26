import { onBeforeUnmount, onMounted, ref } from 'vue';

export const motionTokens = {
  fast: 180,
  standard: 320,
  stiffness: 220,
  damping: 27,
} as const;

export function springStep(value: number, velocity: number, target: number, dt: number) {
  const delta = Math.min(Math.max(dt, 0), 1 / 30);
  const nextVelocity =
    velocity + ((target - value) * motionTokens.stiffness - velocity * motionTokens.damping) * delta;
  return { value: value + nextVelocity * delta, velocity: nextVelocity };
}

export function useSpringValues(initial: number[]) {
  const values = ref([...initial]);
  let target = [...initial];
  let velocity = initial.map(() => 0);
  let frame = 0;
  let previous = 0;
  let media: MediaQueryList | null = null;

  const snap = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    velocity = target.map(() => 0);
    values.value = [...target];
  };
  const tick = (time: number) => {
    if (document.hidden || media?.matches) {
      snap();
      return;
    }
    const dt = previous ? (time - previous) / 1000 : 1 / 60;
    previous = time;
    let moving = false;
    const next = values.value.map((value, index) => {
      const step = springStep(value, velocity[index], target[index], dt);
      velocity[index] = step.velocity;
      if (Math.abs(step.value - target[index]) < 0.04 && Math.abs(step.velocity) < 0.04) return target[index];
      moving = true;
      return step.value;
    });
    values.value = next;
    frame = moving ? requestAnimationFrame(tick) : 0;
    if (!moving) previous = 0;
  };
  const setTarget = (next: number[], immediate = false) => {
    if (next.length !== target.length) throw new Error('弹簧维度不能改变');
    target = [...next];
    if (immediate || document.hidden || media?.matches) {
      snap();
      return;
    }
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const onVisibility = () => {
    if (document.hidden) snap();
  };
  onMounted(() => {
    media = matchMedia('(prefers-reduced-motion: reduce)');
    media.addEventListener('change', snap);
    document.addEventListener('visibilitychange', onVisibility);
    if (media.matches) snap();
  });
  onBeforeUnmount(() => {
    cancelAnimationFrame(frame);
    media?.removeEventListener('change', snap);
    document.removeEventListener('visibilitychange', onVisibility);
  });
  return { values, setTarget, stop: snap };
}
