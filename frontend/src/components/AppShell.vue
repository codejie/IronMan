<script setup lang="ts">
import { Bell, ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen, Shield, UserRound } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isMenuSection, menuFor, type MenuSection } from "@/navigation/menu";
import { useSession } from "@/stores/session";

const route = useRoute();
const router = useRouter();
const { currentUser, logout } = useSession();
const menuNodes = computed(() => menuFor());
const expandedSections = ref<string[]>([]);
const isSidebarCollapsed = ref(false);
const isUserMenuOpen = ref(false);
const userName = computed(() => currentUser.value?.displayName ?? "用户");
const userEmail = computed(() => currentUser.value?.email ?? "账户设置");

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
  isUserMenuOpen.value = false;
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
      <div class="batman-sidebar-actions" aria-label="快捷入口">
        <RouterLink :class="['batman-sidebar-action', { active: isRouteActive('/automation/alerts') }]" aria-label="提醒" title="提醒" to="/automation/alerts"><Bell :size="17" /><span>提醒</span></RouterLink>
        <div class="batman-user-entry">
          <button class="batman-sidebar-action" :aria-expanded="isUserMenuOpen" aria-label="用户" title="用户" type="button" @click="isUserMenuOpen = !isUserMenuOpen"><UserRound :size="17" /><span>用户</span><ChevronDown :class="['batman-user-chevron', { open: isUserMenuOpen }]" :size="13" /></button>
          <div v-show="isUserMenuOpen" class="batman-user-menu">
            <p class="batman-user-card"><strong>{{ userName }}</strong><span>{{ userEmail }}</span></p>
            <RouterLink class="batman-user-menu-item" aria-label="用户设置" to="/settings/profile" @click="isUserMenuOpen = false"><UserRound :size="14" /><span>用户设置</span></RouterLink>
            <button class="batman-user-menu-item" aria-label="退出登录" type="button" @click="signOut"><LogOut :size="14" /><span>退出登录</span></button>
          </div>
        </div>
      </div>
    </aside>
    <main class="batman-main"><RouterView /></main>
  </div>
</template>
