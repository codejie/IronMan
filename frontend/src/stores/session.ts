import { computed, ref } from "vue";
import { api, ApiError, type Session, type User } from "@/api/client";

const storageKey = "ironman.session";
const session = ref<Session | null>(loadSession());

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? null : (JSON.parse(raw) as Session);
  } catch {
    return null;
  }
}

function persist(next: Session | null): void {
  session.value = next;
  if (next === null) {
    localStorage.removeItem(storageKey);
  } else {
    localStorage.setItem(storageKey, JSON.stringify(next));
  }
}

export function useSession() {
  const currentUser = computed<User | null>(() => session.value?.user ?? null);
  const token = computed(() => session.value?.token ?? null);

  async function login(email: string, password: string): Promise<void> {
    persist(await api.login(email, password));
  }

  async function register(email: string, password: string, displayName: string): Promise<void> {
    persist(await api.register(email, password, displayName));
  }

  async function validate(): Promise<boolean> {
    if (session.value === null) {
      return false;
    }
    try {
      const user = await api.me(session.value.token);
      persist({ ...session.value, user });
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        persist(null);
      }
      return false;
    }
  }

  async function logout(): Promise<void> {
    if (session.value !== null) {
      try {
        await api.logout(session.value.token);
      } finally {
        persist(null);
      }
    }
  }

  function replaceUser(user: User): void {
    if (session.value !== null) {
      persist({ ...session.value, user });
    }
  }

  return { currentUser, login, logout, register, replaceUser, token, validate };
}
