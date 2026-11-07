<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from './Icon.vue';
import { ringArea } from '../data/geometry';
import { AIRSPACE_META, type AirspaceKind } from '../data/scenario';

const props = defineProps<{ rings: [number, number][][] }>();

const emit = defineEmits<{
  submit: [
    payload: { name: string; kind: AirspaceKind; minAlt: number; maxAlt: number }
  ];
  cancel: [];
}>();

const KINDS: AirspaceKind[] = ['advisory', 'no-fly', 'control', 'temporary'];

const KIND_COLOR: Record<AirspaceKind, string> = {
  control: '#4F7DF3',
  advisory: '#2BB6A8',
  'no-fly': '#E5484D',
  temporary: '#E49A2F'
};

const DEFAULTS: Record<AirspaceKind, { min: number; max: number }> = {
  advisory: { min: 0, max: 120 },
  'no-fly': { min: 0, max: 300 },
  control: { min: 0, max: 300 },
  temporary: { min: 0, max: 150 }
};

const kind = ref<AirspaceKind>('advisory');
const name = ref(`新增${AIRSPACE_META.advisory.label}`);
const minAlt = ref(DEFAULTS.advisory.min);
const maxAlt = ref(DEFAULTS.advisory.max);

const area = computed(
  () => props.rings.reduce((sum, ring) => sum + ringArea(ring), 0) / 1_000_000
);

const vertexCount = computed(() =>
  props.rings.reduce((count, ring) => count + ring.length, 0)
);

const invalid = computed(
  () => !name.value.trim() || !Number.isFinite(maxAlt.value) || maxAlt.value <= minAlt.value || minAlt.value < 0
);

function pickKind(next: AirspaceKind): void {
  const wasDefault = !name.value.trim() || name.value.startsWith('新增');
  kind.value = next;
  minAlt.value = DEFAULTS[next].min;
  maxAlt.value = DEFAULTS[next].max;
  if (wasDefault) name.value = `新增${AIRSPACE_META[next].label}`;
}

function submit(): void {
  if (invalid.value) return;
  emit('submit', {
    name: name.value.trim(),
    kind: kind.value,
    minAlt: Math.max(0, Math.round(minAlt.value)),
    maxAlt: Math.round(maxAlt.value)
  });
}
</script>

<template>
  <section class="air-form" role="dialog" aria-modal="true" aria-label="新建空域">
    <header class="air-form-head">
      <div>
        <h2>新建空域</h2>
        <p>{{ rings.length }} 块 · {{ vertexCount }} 顶点 · {{ area.toFixed(2) }} km²</p>
      </div>
      <button type="button" class="icon-btn" title="关闭" @click="emit('cancel')">
        <Icon name="x" :size="17" />
      </button>
    </header>

    <div class="air-form-body">
      <label class="field">
        <span>空域名称</span>
        <input v-model="name" maxlength="18" placeholder="例如：后海临时禁飞区" />
      </label>

      <div class="field">
        <span>空域类型</span>
        <div class="kind-grid">
          <button
            v-for="item in KINDS"
            :key="item"
            type="button"
            class="kind-chip"
            :class="{ active: kind === item }"
            @click="pickKind(item)"
          >
            <i :style="{ background: KIND_COLOR[item] }"></i>
            {{ AIRSPACE_META[item].label }}
          </button>
        </div>
      </div>

      <div class="field">
        <span>高度范围</span>
        <div class="alt-row">
          <label>
            <input v-model.number="minAlt" type="number" min="0" step="10" />
            <em>m</em>
          </label>
          <b>—</b>
          <label>
            <input v-model.number="maxAlt" type="number" min="0" step="10" />
            <em>m</em>
          </label>
        </div>
      </div>

      <p class="air-note">
        创建后立即出现在列表与地图上。若飞行器在该区域内违反规则，告警时间线会自动重算。
      </p>
    </div>

    <footer class="air-form-actions">
      <button type="button" @click="emit('cancel')">取消</button>
      <button type="button" class="primary" :disabled="invalid" @click="submit">创建空域</button>
    </footer>
  </section>
</template>
