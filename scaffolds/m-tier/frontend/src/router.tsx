import { BrowserRouter, Routes, Route } from "react-router-dom";
import { NotFound } from "./views/NotFound";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 路由注册 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
