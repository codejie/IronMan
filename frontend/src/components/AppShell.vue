<script setup lang="ts">
import { LogOut } from "lucide-vue-next";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { menuFor } from "@/navigation/menu";
import { useSession } from "@/stores/session";

const route = useRoute();
const router = useRouter();
const { currentUser, logout } = useSession();
const groups = computed(() => menuFor(currentUser.value?.role ?? "user", ["P0", "P1", "P2", "P3"]));

async function signOut(): Promise<void> {
  await logout();
  await router.replace("/login");
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink class="brand" to="/settings/profile" aria-label="IronMan 首页">IronMan</RouterLink>
      <nav aria-label="主导航">
        <section v-for="group in groups" :key="group.label" class="nav-group">
          <h2>{{ group.label }}</h2>
          <RouterLink
            v-for="item in group.items"
            :key="item.to"
            :class="['nav-item', { active: route.path === item.to }]"
            :to="item.to"
          >
            <component :is="item.icon" :size="17" aria-hidden="true" />
            <span>{{ item.label }}</span>
          </RouterLink>
        </section>
      </nav>
      <div class="sidebar-footer">
        <div class="user-summary">
          <strong>{{ currentUser?.displayName }}</strong>
          <span>{{ currentUser?.role === "admin" ? "管理员" : "用户" }}</span>
        </div>
        <button class="icon-button" type="button" title="退出登录" aria-label="退出登录" @click="signOut">
          <LogOut :size="18" />
        </button>
      </div>
    </aside>
    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>
