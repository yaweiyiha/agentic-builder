import { useEffect, useState } from "react";
import type { ForumData, Reply, Topic } from "@forum/types";
import { loadForumData, saveForumData } from "./storage";

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useForumStore() {
  const [data, setData] = useState<ForumData>(() => loadForumData());

  useEffect(() => {
    saveForumData(data);
  }, [data]);

  const createTopic = (input: { title: string; body: string; author: string }) => {
    const now = new Date().toISOString();
    const next: Topic = {
      id: uid(),
      title: input.title.trim(),
      body: input.body.trim(),
      author: input.author.trim(),
      createdAt: now,
      updatedAt: now
    };
    setData((prev) => ({ ...prev, topics: [next, ...prev.topics] }));
    return next.id;
  };

  const createReply = (input: { topicId: string; content: string; author: string }) => {
    const now = new Date().toISOString();
    const next: Reply = {
      id: uid(),
      topicId: input.topicId,
      content: input.content.trim(),
      author: input.author.trim(),
      createdAt: now,
      updatedAt: now
    };
    setData((prev) => ({ ...prev, replies: [...prev.replies, next] }));
  };

  const updateReply = (replyId: string, content: string) => {
    setData((prev) => ({
      ...prev,
      replies: prev.replies.map((reply) =>
        reply.id === replyId
          ? { ...reply, content: content.trim(), updatedAt: new Date().toISOString() }
          : reply
      )
    }));
  };

  const deleteReply = (replyId: string) => {
    setData((prev) => ({
      ...prev,
      replies: prev.replies.filter((reply) => reply.id !== replyId)
    }));
  };

  return {
    data,
    createTopic,
    createReply,
    updateReply,
    deleteReply
  };
}
