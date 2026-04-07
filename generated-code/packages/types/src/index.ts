export interface Topic {
  id: string;
  title: string;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface Reply {
  id: string;
  topicId: string;
  content: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface ForumData {
  topics: Topic[];
  replies: Reply[];
}
