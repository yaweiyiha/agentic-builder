import type { ForumData } from "@forum/types";

const FORUM_DATA_KEY = "forum-data-v1";
const VIEWER_NAME_KEY = "forum-viewer-name-v1";

const defaultData: ForumData = {
  topics: [],
  replies: []
};

export function loadForumData(): ForumData {
  try {
    const raw = localStorage.getItem(FORUM_DATA_KEY);
    if (!raw) return defaultData;
    const parsed = JSON.parse(raw) as ForumData;
    if (!Array.isArray(parsed.topics) || !Array.isArray(parsed.replies)) {
      return defaultData;
    }
    return parsed;
  } catch {
    return defaultData;
  }
}

export function saveForumData(data: ForumData): void {
  localStorage.setItem(FORUM_DATA_KEY, JSON.stringify(data));
}

export function loadViewerName(): string {
  return localStorage.getItem(VIEWER_NAME_KEY) || "You";
}

export function saveViewerName(name: string): void {
  localStorage.setItem(VIEWER_NAME_KEY, name);
}
