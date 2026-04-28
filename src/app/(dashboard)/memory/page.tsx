"use client";

import { useEffect } from "react";

import MemoryFilterBar from "@/components/memory/MemoryFilterBar";
import MemoryListSidebar from "@/components/memory/MemoryListSidebar";
import MemoryRecordDetail from "@/components/memory/MemoryRecordDetail";
import { useMemoryStore } from "@/store/memory-store";

export default function MemoryPage() {
  const fetchList = useMemoryStore((s) => s.fetchList);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  return (
    <main className="flex h-[calc(100vh-72px)] flex-col">
      <MemoryFilterBar />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[400px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-white">
          <MemoryListSidebar />
        </aside>
        <section className="flex-1 overflow-hidden">
          <MemoryRecordDetail />
        </section>
      </div>
    </main>
  );
}
