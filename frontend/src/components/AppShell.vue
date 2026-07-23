<script setup lang="ts">
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen, Shield } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isMenuSection, menuFor, type MenuSection } from "@/navigation/menu";
import { useSession } from "@/stores/session";

const route = useRoute();
const router = useRouter();
const { logout } = useSession();
const menuNodes = computed(() => menuFor());
const expandedSections = ref<string[]>([]);
const isSidebarCollapsed = ref(false);

function isRouteActive(path: string): boolean {
  return route.path === path || route.path.startsWith(`${path}/`);
}

function hasActiveRoute(section: MenuSection): boolean {
  return section.children.some((item) => isRouteActive(item.to));
}

function isExpanded(section: MenuSection): boolean {
  return hasActiveRoute(section) || expandedSections.value.includes(section.label);
}

function toggle(section: MenuSection): void {
  expandedSections.value = isExpanded(section) && !hasActiveRoute(section) ? [] : [section.label];
}

async function signOut(): Promise<void> {
  await logout();
  await router.replace("/login");
}
</script>

<template>
  <div :class="['batman-shell', { 'is-sidebar-collapsed': isSidebarCollapsed }]">
    <aside class="batman-sidebar">
      <div class="batman-brand-row">
        <RouterLink class="batman-brand" to="/holding/list" aria-label="IronMan 首页"><Shield :size="28" /><span>IronMan</span></RouterLink>
        <button
          :aria-label="isSidebarCollapsed ? '展开菜单' : '收起菜单'"
          :title="isSidebarCollapsed ? '展开菜单' : '收起菜单'"
          class="batman-sidebar-toggle"
          type="button"
          @click="isSidebarCollapsed = !isSidebarCollapsed"
        >
          <PanelLeftOpen v-if="isSidebarCollapsed" :size="17" />
          <PanelLeftClose v-else :size="17" />
        </button>
      </div>
      <nav class="batman-navigation" aria-label="Batman 主导航">
        <template v-for="item in menuNodes" :key="item.label">
          <RouterLink v-if="!isMenuSection(item)" :class="['batman-nav-link', { active: isRouteActive(item.to) }]" :title="isSidebarCollapsed ? item.label : undefined" :to="item.to"><component :is="item.icon" :size="16" /><span>{{ item.label }}</span></RouterLink>
          <section v-else class="batman-nav-section">
            <button :class="['batman-nav-link', { active: hasActiveRoute(item) }]" :aria-expanded="isExpanded(item)" :title="isSidebarCollapsed ? item.label : undefined" type="button" @click="toggle(item)"><component :is="item.icon" :size="16" /><span>{{ item.label }}</span><ChevronDown :class="['batman-nav-chevron', { open: isExpanded(item) }]" :size="14" /></button>
            <div v-show="isExpanded(item)" class="batman-nav-children"><RouterLink v-for="child in item.children" :key="child.to" :class="['batman-nav-link', 'is-child', { active: isRouteActive(child.to) }]" :title="isSidebarCollapsed ? child.label : undefined" :to="child.to"><component :is="child.icon" :size="14" /><span>{{ child.label }}</span></RouterLink></div>
          </section>
        </template>
      </nav>
      <button class="batman-signout" aria-label="退出登录" title="退出登录" type="button" @click="signOut"><LogOut :size="17" /></button>
    </aside>
    <main class="batman-main"><RouterView /></main>
  </div>
</template>
