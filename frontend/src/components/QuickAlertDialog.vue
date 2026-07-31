<script setup lang="ts">
import { X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import {
  api,
  ApiError,
  type AlertDirection,
  type AlertRuleKind,
  type AlertScopeType,
  type AlertSeverity,
} from "@/api/client";
import { useSession } from "@/stores/session";

interface AlertInstrument {
  id: string;
  name: string;
}

const props = withDefaults(defineProps<{
  instrument: AlertInstrument | null;
  open: boolean;
  kind: Extract<AlertRuleKind, "price_threshold" | "target_price">;
  scopeType: AlertScopeType;
  initialDirection?: AlertDirection;
  initialPrice?: number | null;
  currentPrice?: number | null;
  severity?: AlertSeverity;
  title?: string;
}>(), {
  initialDirection: "above",
  initialPrice: null,
  currentPrice: null,
  severity: "warning",
  title: "设置提醒",
});

const emit = defineEmits<{
  close: [];
  created: [name: string];
}>();

const { token } = useSession();
const direction = ref<AlertDirection>("above");
const triggerPrice = ref("");
const cooldownMinutes = ref("240");
const errorMessage = ref("");
const isSaving = ref(false);
const directionLabel = computed(() => direction.value === "above" ? "高于" : "低于");
const priceLabel = computed(() => props.kind === "target_price" ? "目标价格" : "触发价格");

function resetDraft(): void {
  direction.value = props.initialDirection;
  triggerPrice.value = props.initialPrice === null || props.initialPrice === undefined ? "" : String(props.initialPrice);
  cooldownMinutes.value = "240";
  errorMessage.value = "";
}

watch(
  () => [props.open, props.instrument?.id, props.initialDirection, props.initialPrice] as const,
  ([open]) => {
    if (open) resetDraft();
  },
  { immediate: true },
);

function close(): void {
  if (!isSaving.value) emit("close");
}

function formatPrice(value: number): string {
  return value.toFixed(4);
}

async function create(): Promise<void> {
  if (token.value === null || props.instrument === null || isSaving.value) return;
  const price = Number(triggerPrice.value);
  const cooldown = Number(cooldownMinutes.value);
  if (!Number.isFinite(price) || price <= 0) {
    errorMessage.value = "请输入大于 0 的触发价格";
    return;
  }
  if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 10_080) {
    errorMessage.value = "冷却时间必须在 1 到 10080 分钟之间";
    return;
  }
  isSaving.value = true;
  errorMessage.value = "";
  try {
    const condition = props.kind === "target_price"
      ? { direction: direction.value, targetPrice: price }
      : { direction: direction.value, threshold: price };
    await api.createAlertRule(token.value, {
      name: `${props.instrument.name} ${directionLabel.value} ${formatPrice(price)}`,
      kind: props.kind,
      instrumentId: props.instrument.id,
      condition,
      cooldownMinutes: cooldown,
      scopeType: props.scopeType,
      severity: props.severity,
    });
    emit("created", props.instrument.name);
    emit("close");
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "创建提醒失败";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div v-if="open" class="batman-dialog-backdrop" @click.self="close">
    <section class="batman-dialog" aria-modal="true" role="dialog">
      <header>
        <strong>{{ title }}</strong>
        <button aria-label="关闭对话框" class="batman-icon-button" title="关闭" type="button" @click="close"><X :size="17" /></button>
      </header>
      <form class="batman-form" @submit.prevent="create">
        <p class="quick-alert-instrument"><strong>{{ instrument?.name }}</strong><span data-quick-alert-current-price>当前价 {{ currentPrice === null ? "暂无" : formatPrice(currentPrice) }}</span></p>
        <label>触发方向<select v-model="direction" aria-label="触发方向"><option value="above">价格高于</option><option value="below">价格低于</option></select></label>
        <label>{{ priceLabel }}<input v-model="triggerPrice" aria-label="触发价格" required step="any" type="number" /></label>
        <label>冷却时间（分钟）<input v-model="cooldownMinutes" aria-label="冷却时间" max="10080" min="1" required step="1" type="number" /></label>
        <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
        <footer><button class="batman-button" type="button" @click="close">取消</button><button class="batman-button primary" :disabled="isSaving" type="submit">创建提醒</button></footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.quick-alert-instrument { display: grid; gap: 4px; margin: 0; }.quick-alert-instrument strong { color: #79dcd2; font-size: 13px; }.quick-alert-instrument span { color: #a9bdd1; font-size: 12px; }
</style>
