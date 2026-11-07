<script setup lang="ts">
import { computed } from 'vue';

type IconShape = { d: string; fill?: boolean };

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number | string;
  }>(),
  { size: 18 }
);

const icons: Record<string, IconShape[]> = {
  radar: [
    { d: 'M12 12 19 5' },
    { d: 'M12 3a9 9 0 1 0 9 9' },
    { d: 'M12 7a5 5 0 1 0 5 5' },
    { d: 'M12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z', fill: true }
  ],
  layers: [
    { d: 'm12 3 9 4.5-9 4.5-9-4.5L12 3Z' },
    { d: 'm3 12 9 4.5 9-4.5' },
    { d: 'm3 16.5 9 4.5 9-4.5' }
  ],
  route: [
    { d: 'M4 18c4-8 12 8 16 0' },
    { d: 'M4 18a1.6 1.6 0 1 0 0 .1' },
    { d: 'M20 18a1.6 1.6 0 1 0 0 .1' }
  ],
  drone: [
    { d: 'M5 8h4l3 3h4l3-3h4' },
    { d: 'M7 8v7' },
    { d: 'M17 8v7' },
    { d: 'M9 15h6' },
    { d: 'M12 11v8' },
    { d: 'M9 19h6' }
  ],
  alert: [
    { d: 'M12 3 22 20H2L12 3Z' },
    { d: 'M12 9v5' },
    { d: 'M12 17.5v.1' }
  ],
  play: [{ d: 'M8 5v14l11-7L8 5Z', fill: true }],
  pause: [
    { d: 'M7 5h3v14H7z', fill: true },
    { d: 'M14 5h3v14h-3z', fill: true }
  ],
  maximize: [
    { d: 'M9 4H4v5' },
    { d: 'M15 4h5v5' },
    { d: 'M20 15v5h-5' },
    { d: 'M9 20H4v-5' }
  ],
  rotate: [
    { d: 'M20 11a8 8 0 1 1-2.3-5.7' },
    { d: 'M20 4v7h-7' }
  ],
  map: [
    { d: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z' },
    { d: 'M9 3v15' },
    { d: 'M15 6v15' }
  ],
  sun: [
    { d: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z' },
    { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }
  ],
  moon: [{ d: 'M20.5 14.2A8.7 8.7 0 0 1 9.8 3.5 8.7 8.7 0 1 0 20.5 14.2Z' }],
  globe: [
    { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z' },
    { d: 'M3 12h18' },
    { d: 'M12 3c3 3.5 3 14.5 0 18' },
    { d: 'M12 3c-3 3.5-3 14.5 0 18' }
  ],
  search: [
    { d: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z' },
    { d: 'm16 16 5 5' }
  ],
  target: [
    { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z' },
    { d: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z' },
    { d: 'M12 11.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Z', fill: true }
  ],
  locate: [
    { d: 'M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z' },
    { d: 'M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z' }
  ],
  follow: [
    { d: 'M12 3v4M12 17v4M3 12h4M17 12h4' },
    { d: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z' },
    { d: 'M12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z', fill: true }
  ],
  eye: [
    { d: 'M2.6 12S6.2 5.6 12 5.6 21.4 12 21.4 12 17.8 18.4 12 18.4 2.6 12 2.6 12Z' },
    { d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z' }
  ],
  move: [
    { d: 'M12 3v18M3 12h18' },
    { d: 'm9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3' }
  ],
  chevron: [{ d: 'm9 18 6-6-6-6' }],  clock: [
    { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z' },
    { d: 'M12 7v5l3 2' }
  ],
  signal: [{ d: 'M4 20v-3M9 20v-6M14 20V9M19 20V4' }],
  x: [{ d: 'M6 6l12 12M18 6 6 18' }],
  cube: [
    { d: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z' },
    { d: 'm4 7.5 8 4.5 8-4.5' },
    { d: 'M12 12v9' }
  ],
  shield: [
    { d: 'M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z' },
    { d: 'm9 12 2 2 4-4' }
  ],
  wind: [
    { d: 'M3 8h11a3 3 0 1 0-3-3' },
    { d: 'M3 12h16a3 3 0 1 1-3 3' },
    { d: 'M3 16h7' }
  ],
  palette: [
    { d: 'M12 3a9 9 0 1 0 0 18h1.2a1.9 1.9 0 0 0 0-3.8H12a2.2 2.2 0 0 1 0-4.4h5.2A3.8 3.8 0 0 0 21 9.2C21 5.8 17 3 12 3Z' },
    { d: 'M7.5 10.5h.01M9.5 7.5h.01M14 7.5h.01M17 10h.01' }
  ],
  monitor: [
    { d: 'M3 4.5h18v12H3z' },
    { d: 'M8 20h8M12 16.5V20' }
  ],
  layout: [
    { d: 'M4 4h16v16H4z' },
    { d: 'M9.5 4v16' },
    { d: 'M9.5 12h10.5' }
  ],
  upload: [
    { d: 'M12 16V4' },
    { d: 'm7 9 5-5 5 5' },
    { d: 'M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }
  ],
  routePlan: [
    { d: 'M4 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z' },
    { d: 'M20 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z' },
    { d: 'M6 15V9a3 3 0 0 1 3-3h6' },
    { d: 'm13 4 2 2-2 2' }
  ],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  minus: [{ d: 'M5 12h14' }],
  check: [{ d: 'm5 12.5 4.5 4.5L19 6.5' }]
};

const shapes = computed(() => icons[props.name] ?? []);
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.05"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      v-for="(shape, index) in shapes"
      :key="`${name}-${index}`"
      :d="shape.d"
      :fill="shape.fill ? 'currentColor' : 'none'"
      :stroke="shape.fill ? 'none' : 'currentColor'"
    />
  </svg>
</template>
