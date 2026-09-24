"use client";

import { readResponseJson } from "@/lib/api/read-response-json";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  NotificationToastStack,
  type NotificationToastItem,
} from "@/components/notifications/notification-toast";
import { useAuth } from "@/contexts/auth-provider";

type NotificationRecord = {
  id: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string;
  type: string;
};

type NotificationsContextValue = {
  unreadCount: number;
  notifications: NotificationRecord[];
  birthdayReminders: NotificationRecord[];
  loading: boolean;
  refresh: () => Promise<void>;
  markAsRead: (id: string) => Promise<boolean>;
  markAllAsRead: () => Promise<boolean>;
  pushToast: (toast: Omit<NotificationToastItem, "id"> & { id?: string }) => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const TOAST_AUTO_DISMISS_MS = 6_000;

async function fetchNotifications(): Promise<{
  notifications: NotificationRecord[];
  birthdayReminders: NotificationRecord[];
  unreadCount: number;
}> {
  const res = await fetch("/api/notifications", { cache: "no-store", credentials: "include" });
  const data = await readResponseJson<{
    success?: boolean;
    notifications?: NotificationRecord[];
    birthdayReminders?: NotificationRecord[];
    unreadCount?: number;
  }>(res, "fetch");

  if (!res.ok || !data.success) {
    throw new Error("Failed to load notifications");
  }

  const notifications = data.notifications ?? [];
  return {
    notifications,
    birthdayReminders: data.birthdayReminders ?? [],
    unreadCount: data.unreadCount ?? notifications.filter((item) => !item.read).length,
  };
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [birthdayReminders, setBirthdayReminders] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<NotificationToastItem[]>([]);

  const initializedRef = useRef(false);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (toast: Omit<NotificationToastItem, "id"> & { id?: string }) => {
      const id = toast.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const item: NotificationToastItem = {
        id,
        title: toast.title,
        body: toast.body,
        href: toast.href,
        variant: toast.variant ?? "default",
      };

      setToasts((current) => {
        if (current.some((existing) => existing.id === id)) return current;
        return [item, ...current].slice(0, 4);
      });

      const timer = setTimeout(() => dismissToast(id), TOAST_AUTO_DISMISS_MS);
      toastTimersRef.current.set(id, timer);
    },
    [dismissToast],
  );

  const applyFetchedNotifications = useCallback(
    (
      items: NotificationRecord[],
      birthdays: NotificationRecord[],
      options?: { announceNew?: boolean },
    ) => {
      setNotifications(items);
      setBirthdayReminders(birthdays);
      setUnreadCount(items.filter((item) => !item.read).length);

      if (!options?.announceNew) return;

      for (const item of items) {
        if (knownIdsRef.current.has(item.id)) continue;
        knownIdsRef.current.add(item.id);
        if (!item.read) {
          pushToast({
            id: item.id,
            title: item.title,
            body: item.body,
            href: item.href || "/notifications",
          });
        }
      }
    },
    [pushToast],
  );

  const isLoggedIn = Boolean(user?.sheetRow);

  const refresh = useCallback(async () => {
    if (!user?.sheetRow) {
      return;
    }

    try {
      const data = await fetchNotifications();
      const announceNew = initializedRef.current;
      initializedRef.current = true;

      if (!announceNew) {
        for (const item of data.notifications) {
          knownIdsRef.current.add(item.id);
        }
      }

      applyFetchedNotifications(data.notifications, data.birthdayReminders, { announceNew });
    } catch {
      // Keep previous counts on transient failures.
    } finally {
      setLoading(false);
    }
  }, [applyFetchedNotifications, user?.sheetRow]);

  const markAsRead = useCallback(
    async (id: string): Promise<boolean> => {
      const target = notifications.find((item) => item.id === id);
      if (!target || target.read) return true;

      // Optimistic UI — update instantly, sync in background.
      setNotifications((current) =>
        current.map((item) => (item.id === id ? { ...item, read: true } : item)),
      );
      setUnreadCount((count) => Math.max(0, count - 1));

      try {
        const res = await fetch("/api/notifications", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error("Failed to mark notification as read");
        return true;
      } catch {
        setNotifications((current) =>
          current.map((item) => (item.id === id ? { ...item, read: false } : item)),
        );
        setUnreadCount((count) => count + 1);
        return false;
      }
    },
    [notifications],
  );

  const markAllAsRead = useCallback(async (): Promise<boolean> => {
    const previous = notifications;
    const unread = previous.filter((item) => !item.read).length;
    if (unread === 0) return true;

    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);

    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      if (!res.ok) throw new Error("Failed to mark all notifications as read");
      return true;
    } catch {
      setNotifications(previous);
      setUnreadCount(unread);
      return false;
    }
  }, [notifications]);

  useEffect(() => {
    initializedRef.current = false;
    knownIdsRef.current = new Set();

    if (!user?.sheetRow) {
      return;
    }

    let cancelled = false;

    // Defer setState so it is not synchronous inside the effect body.
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      void refresh();
    });

    return () => {
      cancelled = true;
    };
  }, [refresh, user?.sheetRow]);

  useEffect(() => {
    if (!user?.sheetRow) return;

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh, user?.sheetRow]);

  useEffect(() => {
    const toastTimers = toastTimersRef.current;
    return () => {
      for (const timer of toastTimers.values()) {
        clearTimeout(timer);
      }
      toastTimers.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      unreadCount: isLoggedIn ? unreadCount : 0,
      notifications: isLoggedIn ? notifications : [],
      birthdayReminders: isLoggedIn ? birthdayReminders : [],
      loading: isLoggedIn ? loading : false,
      refresh,
      markAsRead,
      markAllAsRead,
      pushToast,
    }),
    [
      isLoggedIn,
      unreadCount,
      notifications,
      birthdayReminders,
      loading,
      refresh,
      markAsRead,
      markAllAsRead,
      pushToast,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <NotificationToastStack items={toasts} onDismiss={dismissToast} />
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return context;
}

export function useNotificationsOptional(): NotificationsContextValue | null {
  return useContext(NotificationsContext);
}
