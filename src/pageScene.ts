import { reactive } from 'vue';

export const pageScene = reactive({ active: false, waiting: false, id: 0, target: '' });
let minimumTimer: ReturnType<typeof setTimeout> | undefined;
let maximumTimer: ReturnType<typeof setTimeout> | undefined;
let minimumElapsed = false;
let ready = false;

function clearTimers() {
  clearTimeout(minimumTimer);
  clearTimeout(maximumTimer);
}
function complete(id: number) {
  if (id !== pageScene.id || !pageScene.active) return;
  clearTimers();
  pageScene.active = false;
  pageScene.waiting = false;
}
function maybeComplete(id: number) {
  if (id === pageScene.id && minimumElapsed && ready) complete(id);
}
export function beginPageScene(target: string) {
  clearTimers();
  const id = ++pageScene.id;
  pageScene.target = target;
  pageScene.active = true;
  pageScene.waiting = false;
  ready = false;
  minimumElapsed = matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden;
  if (!minimumElapsed)
    minimumTimer = setTimeout(() => {
      if (id !== pageScene.id) return;
      minimumElapsed = true;
      pageScene.waiting = !ready;
      maybeComplete(id);
    }, 600);
  maximumTimer = setTimeout(() => complete(id), 8000);
  return id;
}
export function currentPageScene() {
  return pageScene.id;
}
export function usePageReady() {
  const id = currentPageScene();
  return () => markPageReady(id);
}
export function markPageReady(id: number) {
  if (id !== pageScene.id) return;
  ready = true;
  maybeComplete(id);
}
export function cancelPageScene() {
  clearTimers();
  ++pageScene.id;
  pageScene.active = false;
  pageScene.waiting = false;
}
export function releasePageSceneMotion() {
  if (!pageScene.active || (!document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches))
    return;
  minimumElapsed = true;
  pageScene.waiting = !ready;
  maybeComplete(pageScene.id);
}
