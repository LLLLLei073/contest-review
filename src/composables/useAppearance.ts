import { ref } from 'vue';

const key = `contest-review:${import.meta.env.BASE_URL}:appearance`;
export const appearance = ref<'light' | 'dark'>('light');

export function initializeAppearance() {
  try {
    appearance.value = localStorage.getItem(key) === 'dark' ? 'dark' : 'light';
  } catch {
    // Storage restrictions must not prevent the training space from opening.
  }
  document.documentElement.dataset.theme = appearance.value;
}

export function toggleAppearance() {
  appearance.value = appearance.value === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = appearance.value;
  try {
    localStorage.setItem(key, appearance.value);
  } catch {
    // The current session can still switch its appearance without persistence.
  }
}
