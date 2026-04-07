import type { ForumData, Reply, Topic } from "../types/forum";

const STORAGE_KEY = "browser-forum-data-v1";

const defaultData: ForumData = {
  topics: [],
  replies: []
};

export function loadForumData(): ForumData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData;
    const parsed = JSON.parse(raw) as ForumData;
    return {
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      replies: Array.isArray(parsed.replies) ? parsed.replies : []
    };
  } catch {
    return defaultData;
  }
}

export function saveForumData(data: ForumData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function createTopic(title: string, body: string): Topic {
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    body: body.trim(),
    createdAt: new Date().toISOString()
  };
}

export function createReply(topicId: string, content: string): Reply {
  return {
    id: crypto.randomUUID(),
    topicId,
    content: content.trim(),
    createdAt: new Date().toISOString()
  };
}
