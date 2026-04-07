import { Navigate, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import TopicDetailPage from "./pages/TopicDetailPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/topic/:id" element={<TopicDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
