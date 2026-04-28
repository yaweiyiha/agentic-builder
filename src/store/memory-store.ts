"use client";

import { create } from "zustand";

import type { MemoryListItem, StatusFilter } from "@/app/api/memory/route";
import type { MemoryRecord, MemoryKind } from "@/lib/memory/types";

interface MemoryState {
  items: MemoryListItem[];
  total: number;
  loading: boolean;
  error: string | null;

  activeId: string | null;
  activeRecord: MemoryRecord | null;
  detailLoading: boolean;
  detailError: string | null;

  filterStatus: StatusFilter;
  filterKind: MemoryKind | "all";
  search: string;

  fetchList: () => Promise<void>;
  setActive: (id: string | null) => void;
  fetchDetail: (id: string) => Promise<void>;
  setFilterStatus: (s: StatusFilter) => void;
  setFilterKind: (k: MemoryKind | "all") => void;
  setSearch: (s: string) => void;

  approve: (id: string, score?: number) => Promise<boolean>;
  disapprove: (id: string, score?: number) => Promise<boolean>;
  patchRecord: (
    id: string,
    patch: { body?: string; tags?: string[]; score?: number },
  ) => Promise<boolean>;
  deleteRecord: (id: string) => Promise<boolean>;
}

const SUPPORTED_KINDS_DEFAULT: MemoryKind[] = ["failure-pattern", "classification"];

export const useMemoryStore = create<MemoryState>((set, get) => ({
  items: [],
  total: 0,
  loading: false,
  error: null,

  activeId: null,
  activeRecord: null,
  detailLoading: false,
  detailError: null,

  filterStatus: "all",
  filterKind: "all",
  search: "",

  fetchList: async () => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      const { filterStatus, filterKind, search } = get();
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterKind !== "all") params.set("kind", filterKind);
      if (search.trim()) params.set("search", search.trim());
      const resp = await fetch(`/api/memory?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await resp.json()) as
        | { items: MemoryListItem[]; total: number; supportedKinds: MemoryKind[] }
        | { error: string };
      if (!resp.ok || "error" in data) {
        set({
          loading: false,
          error: "error" in data ? data.error : `HTTP ${resp.status}`,
        });
        return;
      }
      set({ items: data.items, total: data.total, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setActive: (id) => {
    set({ activeId: id, activeRecord: null, detailError: null });
    if (id) void get().fetchDetail(id);
  },

  fetchDetail: async (id) => {
    set({ detailLoading: true, detailError: null });
    try {
      const resp = await fetch(`/api/memory/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const data = (await resp.json()) as
        | { record: MemoryRecord }
        | { error: string };
      if (!resp.ok || "error" in data) {
        set({
          detailLoading: false,
          detailError: "error" in data ? data.error : `HTTP ${resp.status}`,
          activeRecord: null,
        });
        return;
      }
      set({ activeRecord: data.record, detailLoading: false });
    } catch (err) {
      set({
        detailLoading: false,
        detailError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setFilterStatus: (s) => {
    set({ filterStatus: s });
    void get().fetchList();
  },
  setFilterKind: (k) => {
    set({ filterKind: k });
    void get().fetchList();
  },
  setSearch: (s) => {
    set({ search: s });
  },

  approve: async (id, score) => {
    return mutate(`/api/memory/${encodeURIComponent(id)}/approve`, { score }, get, set);
  },
  disapprove: async (id, score) => {
    return mutate(`/api/memory/${encodeURIComponent(id)}/disapprove`, { score }, get, set);
  },
  patchRecord: async (id, patch) => {
    try {
      const resp = await fetch(`/api/memory/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await resp.json()) as
        | { record: MemoryRecord }
        | { error: string };
      if (!resp.ok || "error" in data) {
        set({
          detailError: "error" in data ? data.error : `HTTP ${resp.status}`,
        });
        return false;
      }
      set({ activeRecord: data.record });
      await get().fetchList();
      return true;
    } catch (err) {
      set({ detailError: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },
  deleteRecord: async (id) => {
    try {
      const resp = await fetch(`/api/memory/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string };
        set({ detailError: data.error ?? `HTTP ${resp.status}` });
        return false;
      }
      set({ activeId: null, activeRecord: null });
      await get().fetchList();
      return true;
    } catch (err) {
      set({ detailError: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },
}));

export const SUPPORTED_KINDS = SUPPORTED_KINDS_DEFAULT;
export type { MemoryListItem, StatusFilter };

async function mutate(
  url: string,
  body: unknown,
  get: () => MemoryState,
  set: (
    s: Partial<MemoryState> | ((s: MemoryState) => Partial<MemoryState>),
  ) => void,
): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await resp.json()) as
      | { record: MemoryRecord }
      | { error: string };
    if (!resp.ok || "error" in data) {
      set({
        detailError: "error" in data ? data.error : `HTTP ${resp.status}`,
      });
      return false;
    }
    set({ activeRecord: data.record });
    await get().fetchList();
    return true;
  } catch (err) {
    set({ detailError: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
