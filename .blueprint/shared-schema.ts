// Source of truth for every type that crosses the API boundary or that
// frontend AND backend code both touch. Both sides MUST import from this
// module rather than redefine. No `any`. ISO 8601 strings for timestamps.

export type UserId = string;
export type TaskId = string;
export type SessionId = string;

export type TaskStatus = "to_do" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface User {
  id: UserId;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: SessionId;
  userId: UserId;
  expiresAt: string;
  createdAt: string;
}

export interface Task {
  id: TaskId;
  userId: UserId;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUserResponse {
  user: User;
}

export interface RegisterRequest {
  displayName: string;
  email: string;
  password: string;
}

export interface RegisterResponse {
  user: User;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
}

export interface LogoutRequest {
  sessionId?: SessionId;
}

export interface LogoutResponse {
  success: true;
}

export interface MeResponse {
  user: User | null;
}

export interface UpdateMeRequest {
  displayName?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface UpdateMeResponse {
  user: User;
}

export interface DeleteMeRequest {
  password: string;
}

export interface DeleteMeResponse {
  success: true;
}

export interface ListTasksRequest {
  status?: TaskStatus | "all";
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
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
}

export interface CreateTaskResponse {
  task: Task;
}

export interface UpdateTaskRequest {
  id: TaskId;
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
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

export interface HealthResponse {
  status: "ok";
  timestamp: string;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Array<{
      field?: string;
      message: string;
    }>;
  };
}