export interface ApiConfig {
  baseURL: string;
}

// 默认使用相对路径走 Vite dev server 代理，生产环境可通过 VITE_API_BASE_URL 覆盖
const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export type ApiQueryValue = string | number | boolean | null | undefined;

export interface ApiRequestOptions {
  /** Attach Authorization: Bearer <token> from localStorage. Default true. */
  auth?: boolean;
  /** Extra request headers merged on top of the default JSON headers. */
  headers?: Record<string, string>;
  /** Appended to the URL as a query string. `null`/`undefined` values are dropped. */
  query?: Record<string, ApiQueryValue> | URLSearchParams;
  /** Forwarded to the underlying fetch signal for cancellation. */
  signal?: AbortSignal;
}

function serialiseQuery(query: ApiRequestOptions["query"]): string {
  if (!query) return "";
  if (query instanceof URLSearchParams) {
    const s = query.toString();
    return s ? `?${s}` : "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    params.append(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function request<T>(
  path: string,
  init: RequestInit,
  opts: ApiRequestOptions = {},
): Promise<T> {
  const auth = opts.auth ?? true;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers ?? {}),
  };

  if (auth) {
    const token = localStorage.getItem("token");
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const url = `${API_BASE}${path}${serialiseQuery(opts.query)}`;
  const res = await fetch(url, { ...init, headers, signal: opts.signal });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText || "请求失败"}`;
    try {
      const data = await res.json();
      if (data && typeof data === "object" && "message" in data) {
        message = String((data as { message: unknown }).message);
      }
    } catch (err) {
      // Body was not JSON; keep default message and attach the parse cause.
      throw new Error(message, { cause: err });
    }
    throw new Error(message);
  }

  if (res.status === 204) {
    // no content
    return undefined as unknown as T;
  }

  return (await res.json()) as T;
}

export const apiClient = {
  get<T>(path: string, opts?: ApiRequestOptions): Promise<T> {
    return request<T>(path, { method: "GET" }, opts);
  },
  post<T, B = unknown>(
    path: string,
    body?: B,
    opts?: ApiRequestOptions,
  ): Promise<T> {
    return request<T>(
      path,
      { method: "POST", body: JSON.stringify(body ?? {}) },
      opts,
    );
  },
  put<T, B = unknown>(
    path: string,
    body?: B,
    opts?: ApiRequestOptions,
  ): Promise<T> {
    return request<T>(
      path,
      { method: "PUT", body: JSON.stringify(body ?? {}) },
      opts,
    );
  },
  patch<T, B = unknown>(
    path: string,
    body?: B,
    opts?: ApiRequestOptions,
  ): Promise<T> {
    return request<T>(
      path,
      { method: "PATCH", body: JSON.stringify(body ?? {}) },
      opts,
    );
  },
  delete<T>(path: string, opts?: ApiRequestOptions): Promise<T> {
    return request<T>(path, { method: "DELETE" }, opts);
  },
};
