// Source of truth for every type that crosses the API boundary or that
// frontend AND backend code both touch. Both sides MUST import from this
// module rather than redefine. No `any`. ISO 8601 strings for timestamps.

export type UserId = string;
export type TaskId = string;
export type RefreshTokenId = string;
export type PasswordResetTokenId = string;
export type AuditEventId = string;

export type ThemePreference = "light" | "dark";
export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "in_progress" | "done";
export type TaskSortField = "dueDate" | "createdAt";
export type SortDirection = "asc" | "desc";

export interface User {
  id: UserId;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: TaskId;
  userId: UserId;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
}

export interface RefreshToken {
  id: RefreshTokenId;
  userId: UserId;
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface PasswordResetToken {
  id: PasswordResetTokenId;
  userId: UserId;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
}

export interface AuditEvent {
  id: AuditEventId;
  userId: UserId | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuthSession {
  user: User;
  accessToken: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  confirmPassword: string;
}

export interface RegisterResponse {
  user: User;
  accessToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  accessToken: string;
}

export interface LogoutRequest {
  refreshToken?: string;
}

export interface LogoutResponse {
  success: true;
}

export interface RefreshSessionRequest {
  refreshToken?: string;
}

export interface RefreshSessionResponse {
  user: User;
  accessToken: string;
}

export interface PasswordResetRequestRequest {
  email: string;
}

export interface PasswordResetRequestResponse {
  success: true;
}

export interface MeResponse {
  user: User;
}

export interface GetProfileResponse {
  user: User;
}

export interface UpdateProfileRequest {
  email: string;
}

export interface UpdateProfileResponse {
  user: User;
}

export interface ListTasksRequest {
  status?: TaskStatus | "all";
  priority?: TaskPriority | "all";
  sort?: TaskSortField;
  direction?: SortDirection;
}

export interface ListTasksResponse {
  tasks: Task[];
}

export interface GetTaskRequest {
  id: TaskId;
}

export interface GetTaskResponse {
  task: Task;
}

export interface CreateTaskRequest {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority: TaskPriority;
}

export interface CreateTaskResponse {
  task: Task;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
}

export interface UpdateTaskResponse {
  task: Task;
}

export interface DeleteTaskRequest {
  id: TaskId;
}

export interface DeleteTaskResponse {
  success: true;
}

export interface DashboardSummaryResponse {
  total: number;
  pending: number;
  done: number;
}

export interface HealthResponse {
  ok: true;
  service: "taskflow-api";
  timestamp: string;
}