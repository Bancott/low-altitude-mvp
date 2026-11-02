import { computed, ref, watchEffect } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'lat-theme';
const mode = ref<ThemeMode>('system');
const systemPrefersDark = ref(false);

const media =
  typeof window !== 'undefined' && 'matchMedia' in window
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

if (media) {
  systemPrefersDark.value = media.matches;
  media.addEventListener('change', (event) => {
    systemPrefersDark.value = event.matches;
  });
}

if (typeof window !== 'undefined') {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'system') {
    mode.value = saved;
  }
}

const resolvedTheme = computed<'light' | 'dark'>(() => {
  if (mode.value === 'system') return systemPrefersDark.value ? 'dark' : 'light';
  return mode.value;
});

function applyTheme(): void {
  if (typeof document === 'undefined') return;
  const theme = resolvedTheme.value;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode.value);
  } catch {
    // localStorage may be unavailable in private/incognito contexts.
  }
}

watchEffect(applyTheme);

export function useTheme() {
  return {
    mode,
    resolvedTheme,
    setMode(next: ThemeMode) {
      mode.value = next;
    }
  };
}
