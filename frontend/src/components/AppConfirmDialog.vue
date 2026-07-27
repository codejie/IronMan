<script setup lang="ts">
import { nextTick, onBeforeUnmount, watch } from "vue";
import { confirmationState, settleConfirmation } from "./confirmation";

let confirmButton: HTMLButtonElement | undefined;

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && confirmationState.isOpen) {
    event.preventDefault();
    settleConfirmation(false);
  }
}

watch(
  () => confirmationState.isOpen,
  async (isOpen) => {
    if (!isOpen) return;
    await nextTick();
    confirmButton?.focus();
  }
);

window.addEventListener("keydown", handleKeydown);
onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Transition name="batman-confirm">
    <div v-if="confirmationState.isOpen" class="batman-dialog-backdrop" @click.self="settleConfirmation(false)">
      <section aria-describedby="batman-confirm-message" aria-labelledby="batman-confirm-title" aria-modal="true" class="batman-dialog batman-confirm" role="dialog">
        <header>
          <strong id="batman-confirm-title">{{ confirmationState.title }}</strong>
        </header>
        <p id="batman-confirm-message">{{ confirmationState.message }}</p>
        <footer>
          <button class="batman-button" type="button" @click="settleConfirmation('cancel')">{{ confirmationState.cancelLabel }}</button>
          <button v-if="confirmationState.discardLabel" data-confirm-discard class="batman-button" type="button" @click="settleConfirmation('discard')">{{ confirmationState.discardLabel }}</button>
          <button ref="confirmButton" :class="['batman-button', confirmationState.tone === 'danger' ? 'danger' : 'primary']" type="button" @click="settleConfirmation('confirm')">{{ confirmationState.confirmLabel }}</button>
        </footer>
      </section>
    </div>
  </Transition>
</template>
