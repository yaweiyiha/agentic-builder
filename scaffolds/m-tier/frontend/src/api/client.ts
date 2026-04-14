export interface ApiConfig {
  baseURL: string;
}

// 默认使用相对路径走 Vite dev server 代理，生产环境可通过 VITE_API_BASE_URL 覆盖
const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

async function request<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (options.auth) {
    const token = localStorage.getItem("token");
    if (token) {
      (headers as Record<string, string>).Authorization = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let message = "请求失败";
    try {
      const data = await res.json();
      message = data.message || message;
    } catch (e) {
      throw new Error(message, e);
    }
  }

  if (res.status === 204) {
    // no content
    return undefined as unknown as T;
  }

  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string, auth = true) =>
    request<T>(path, { method: "GET", auth }),
  post: <T>(path: string, body?: unknown, auth = true) =>
    request<T>(path, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      auth,
    }),
  put: <T>(path: string, body?: unknown, auth = true) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}), auth }),
  delete: <T>(path: string, auth = true) =>
    request<T>(path, { method: "DELETE", auth }),
};
