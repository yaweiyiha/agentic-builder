export interface Topic {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface Reply {
  id: string;
  topicId: string;
  content: string;
  createdAt: string;
}

export interface ForumData {
  topics: Topic[];
  replies: Reply[];
}
