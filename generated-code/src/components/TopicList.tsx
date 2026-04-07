import React from 'react';
import { Link } from 'react-router-dom';

export interface TopicListItem {
  id: string;
  title: string;
  createdAt: string;
}

interface TopicListProps {
  topics: TopicListItem[];
}

const TopicList: React.FC<TopicListProps> = ({ topics }) => {
  if (topics.length === 0) {
    return (
      <div className="rounded-[0.375rem] border border-dashed border-[#d4d4d8] bg-[#ffffff] p-[1rem] text-center text-[0.95rem] text-[#52525b] [font-family:Arial,sans-serif]">
        No topics yet. Create your first discussion.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-[0.5rem]">
      {topics.map((topic) => (
        <li key={topic.id}>
          <Link
            to={`/topic/${topic.id}`}
            className="block rounded-[0.375rem] border border-[#e4e4e7] bg-[#ffffff] p-[1rem] transition-colors hover:border-[#2563eb] hover:bg-[#eff6ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2"
            aria-label={`Open topic: ${topic.title}`}
          >
            <p className="text-[1rem] font-medium text-[#18181b] [font-family:Arial,sans-serif]">
              {topic.title}
            </p>
            <p className="mt-[0.25rem] text-[0.8rem] text-[#52525b] [font-family:Arial,sans-serif]">
              Created {new Date(topic.createdAt).toLocaleString()}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
};

export default TopicList;
