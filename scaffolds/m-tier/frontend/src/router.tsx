import { Routes, Route } from "react-router-dom";
import { NotFound } from "./views/NotFound";

export function AppRouter() {
  return (
    <Routes>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
