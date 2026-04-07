export interface StoredTopic {
  id: string;
  title: string;
  content?: string;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface StoredReply {
  id: string;
  topicId: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ForumStorageData {
  topics: StoredTopic[];
  replies: StoredReply[];
}

const STORAGE_KEY = "forum-storage-v1";

const DEFAULT_FORUM_DATA: ForumStorageData = {
  topics: [],
  replies: [],
};

const isBrowser = (): boolean => typeof window !== "undefined";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isValidTopic = (value: unknown): value is StoredTopic =>
  isObject(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  typeof value.createdAt === "string";

const isValidReply = (value: unknown): value is StoredReply =>
  isObject(value) &&
  typeof value.id === "string" &&
  typeof value.topicId === "string" &&
  typeof value.content === "string" &&
  typeof value.createdAt === "string";

const normalizeData = (value: unknown): ForumStorageData => {
  if (!isObject(value)) return DEFAULT_FORUM_DATA;

  const rawTopics = Array.isArray(value.topics) ? value.topics : [];
  const rawReplies = Array.isArray(value.replies) ? value.replies : [];

  return {
    topics: rawTopics.filter(isValidTopic),
    replies: rawReplies.filter(isValidReply),
  };
};

export const getForumStorageData = (): ForumStorageData => {
  if (!isBrowser()) return DEFAULT_FORUM_DATA;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FORUM_DATA;

    const parsed = JSON.parse(raw) as unknown;
    return normalizeData(parsed);
  } catch {
    return DEFAULT_FORUM_DATA;
  }
};

export const saveForumStorageData = (data: ForumStorageData): void => {
  if (!isBrowser()) return;

  const normalized = normalizeData(data);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
};

export const getStoredTopics = (): StoredTopic[] => getForumStorageData().topics;

export const getStoredReplies = (): StoredReply[] => getForumStorageData().replies;

export const saveStoredTopics = (topics: StoredTopic[]): void => {
  const existing = getForumStorageData();
  saveForumStorageData({
    ...existing,
    topics: topics.filter(isValidTopic),
  });
};

export const saveStoredReplies = (replies: StoredReply[]): void => {
  const existing = getForumStorageData();
  saveForumStorageData({
    ...existing,
    replies: replies.filter(isValidReply),
  });
};

export const upsertTopic = (topic: StoredTopic): StoredTopic[] => {
  const topics = getStoredTopics();
  const index = topics.findIndex((item) => item.id === topic.id);

  if (index === -1) {
    const nextTopics = [topic, ...topics];
    saveStoredTopics(nextTopics);
    return nextTopics;
  }

  const nextTopics = [...topics];
  nextTopics[index] = { ...nextTopics[index], ...topic };
  saveStoredTopics(nextTopics);
  return nextTopics;
};

export const deleteTopic = (topicId: string): ForumStorageData => {
  const { topics, replies } = getForumStorageData();
  const nextTopics = topics.filter((topic) => topic.id !== topicId);
  const nextReplies = replies.filter((reply) => reply.topicId !== topicId);

  const nextData: ForumStorageData = {
    topics: nextTopics,
    replies: nextReplies,
  };

  saveForumStorageData(nextData);
  return nextData;
};

export const upsertReply = (reply: StoredReply): StoredReply[] => {
  const replies = getStoredReplies();
  const index = replies.findIndex((item) => item.id === reply.id);

  if (index === -1) {
    const nextReplies = [...replies, reply];
    saveStoredReplies(nextReplies);
    return nextReplies;
  }

  const nextReplies = [...replies];
  nextReplies[index] = { ...nextReplies[index], ...reply };
  saveStoredReplies(nextReplies);
  return nextReplies;
};

export const deleteReply = (replyId: string): StoredReply[] => {
  const replies = getStoredReplies();
  const nextReplies = replies.filter((reply) => reply.id !== replyId);
  saveStoredReplies(nextReplies);
  return nextReplies;
};

export const clearForumStorage = (): void => {
  if (!isBrowser()) return;
  window.localStorage.removeItem(STORAGE_KEY);
};
