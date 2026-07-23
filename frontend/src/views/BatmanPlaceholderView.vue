<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <section class="batman-placeholder" :aria-label="label"><span>{{ label }}</span></section>
</template>
