// Source of truth for every type that crosses the API boundary or that
// frontend AND backend code both touch. Both sides MUST import from this
// module rather than redefine. No `any`. ISO 8601 strings for timestamps.

export type UserId = string & { readonly brand: "UserId" };
export type ProjectId = string & { readonly brand: "ProjectId" };
export type ProjectMemberId = string & { readonly brand: "ProjectMemberId" };
export type ProjectInvitationId = string & { readonly brand: "ProjectInvitationId" };
export type TaskId = string & { readonly brand: "TaskId" };
export type CommentId = string & { readonly brand: "CommentId" };
export type NotificationId = string & { readonly brand: "NotificationId" };
export type ActivityLogId = string & { readonly brand: "ActivityLogId" };
export type PasswordResetTokenId = string & { readonly brand: "PasswordResetTokenId" };

export type UserStatus = "active" | "disabled";
export type DefaultTaskView = "list" | "board";
export type ProjectStatus = "active" | "archived";
export type ProjectRole = "admin" | "member";
export type ProjectInvitationStatus = "pending" | "accepted" | "expired" | "revoked";
export type TaskStatus = "todo" | "in_progress" | "completed";
export type TaskPriority = "low" | "medium" | "high";
export type NotificationType = "task_assigned" | "task_due_soon" | "project_invite" | "system";
export type RelatedEntityType = "task" | "project" | "comment" | "invitation";
export type ActivityEntityType = "task" | "project";
export type ActivityActionType =
  | "task_created"
  | "task_updated"
  | "task_completed"
  | "task_reopened"
  | "task_deleted"
  | "comment_added"
  | "project_created"
  | "project_updated"
  | "project_archived"
  | "member_invited"
  | "member_joined";

export interface User {
  id: UserId;
  name: string;
  email: string;
  status: UserStatus;
  defaultTaskView: DefaultTaskView;
  createdAt: string;
  updatedAt: string;
}

export interface PasswordResetToken {
  id: PasswordResetTokenId;
  userId: UserId;
  expiresAt: string;
  usedAt?: string;
  createdAt: string;
}

export interface Project {
  id: ProjectId;
  name: string;
  description: string | null;
  ownerUserId: UserId;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ProjectMember {
  id: ProjectMemberId;
  projectId: ProjectId;
  userId: UserId;
  role: ProjectRole;
  invitedByUserId: UserId;
  joinedAt: string | null;
  createdAt: string;
}

export interface ProjectInvitation {
  id: ProjectInvitationId;
  projectId: ProjectId;
  email: string;
  role: ProjectRole;
  invitedByUserId: UserId;
  status: ProjectInvitationStatus;
  expiresAt: string;
  createdAt: string;
}

export interface Task {
  id: TaskId;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  creatorUserId: UserId;
  assigneeUserId: UserId | null;
  projectId: ProjectId | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Comment {
  id: CommentId;
  taskId: TaskId;
  authorUserId: UserId;
  body: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ActivityLog {
  id: ActivityLogId;
  entityType: ActivityEntityType;
  entityId: TaskId | ProjectId;
  actionType: ActivityActionType;
  actorUserId: UserId;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface Notification {
  id: NotificationId;
  userId: UserId;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntityType: RelatedEntityType | null;
  relatedEntityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface PaginatedMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface ApiError {
  code: string;
  message: string;
  fieldErrors?: FieldError[];
}

export interface DashboardSummary {
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  upcomingTasks: number;
}

export interface TaskListItem {
  id: TaskId;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  projectId: ProjectId | null;
  projectName: string | null;
  assigneeUserId: UserId | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListItem {
  id: ProjectId;
  name: string;
  description: string | null;
  status: ProjectStatus;
  memberCount: number;
  taskCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommentView {
  id: CommentId;
  taskId: TaskId;
  authorUserId: UserId;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLogView {
  id: ActivityLogId;
  entityType: ActivityEntityType;
  entityId: TaskId | ProjectId;
  actionType: ActivityActionType;
  actorUserId: UserId;
  actorName: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface NotificationListItem {
  id: NotificationId;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntityType: RelatedEntityType | null;
  relatedEntityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
}
export interface SignupResponse {
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

export interface LogoutRequest {}
export interface LogoutResponse {
  success: boolean;
}

export interface RefreshRequest {}
export interface RefreshResponse {
  accessToken: string;
}

export interface ForgotPasswordRequest {
  email: string;
}
export interface ForgotPasswordResponse {
  success: boolean;
  message: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}
export interface ResetPasswordResponse {
  success: boolean;
}

export interface GetMeResponse {
  user: User;
}

export interface UpdateProfileRequest {
  name: string;
}
export interface UpdateProfileResponse {
  user: User;
}

export interface UpdatePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
export interface UpdatePasswordResponse {
  success: boolean;
}

export interface UpdatePreferencesRequest {
  defaultTaskView: DefaultTaskView;
}
export interface UpdatePreferencesResponse {
  user: User;
}

export interface GetDashboardSummaryResponse {
  summary: DashboardSummary;
}

export interface GetRecentTasksResponse {
  tasks: TaskListItem[];
}

export interface ListTasksRequest {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  projectId?: ProjectId;
  assigneeId?: UserId;
  dueBefore?: string;
  dueAfter?: string;
  sortBy?: "dueDate" | "priority" | "createdAt";
  sortOrder?: "asc" | "desc";
}
export interface ListTasksResponse {
  tasks: TaskListItem[];
  meta: PaginatedMeta;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
  assigneeUserId?: UserId | null;
  projectId?: ProjectId | null;
}
export interface CreateTaskResponse {
  task: Task;
}

export interface GetTaskResponse {
  task: Task;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  assigneeUserId?: UserId | null;
  projectId?: ProjectId | null;
}
export interface UpdateTaskResponse {
  task: Task;
}

export interface DeleteTaskRequest {}
export interface DeleteTaskResponse {
  success: boolean;
}

export interface CompleteTaskRequest {}
export interface CompleteTaskResponse {
  task: Task;
}

export interface ReopenTaskRequest {}
export interface ReopenTaskResponse {
  task: Task;
}

export interface ListTaskCommentsResponse {
  comments: CommentView[];
}

export interface CreateTaskCommentRequest {
  body: string;
}
export interface CreateTaskCommentResponse {
  comment: CommentView;
}

export interface ListTaskActivityResponse {
  activity: ActivityLogView[];
}

export interface ListProjectsRequest {
  search?: string;
  status?: ProjectStatus;
}
export interface ListProjectsResponse {
  projects: ProjectListItem[];
}

export interface CreateProjectRequest {
  name: string;
  description?: string | null;
}
export interface CreateProjectResponse {
  project: Project;
}

export interface GetProjectResponse {
  project: Project;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string | null;
}
export interface UpdateProjectResponse {
  project: Project;
}

export interface ArchiveProjectRequest {}
export interface ArchiveProjectResponse {
  project: Project;
}

export interface ListProjectMembersResponse {
  members: Array<{
    id: ProjectMemberId;
    projectId: ProjectId;
    userId: UserId;
    role: ProjectRole;
    invitedByUserId: UserId;
    joinedAt: string | null;
    createdAt: string;
    user: Pick<User, "id" | "name" | "email">;
  }>;
}

export interface CreateProjectInvitationRequest {
  email: string;
  role: ProjectRole;
}
export interface CreateProjectInvitationResponse {
  invitation: ProjectInvitation;
}

export interface ListProjectInvitationsResponse {
  invitations: ProjectInvitation[];
}

export interface ListNotificationsRequest {
  page?: number;
  pageSize?: number;
}
export interface ListNotificationsResponse {
  notifications: NotificationListItem[];
  meta: PaginatedMeta;
}

export interface GetUnreadNotificationCountResponse {
  unreadCount: number;
}

export interface MarkNotificationReadRequest {}
export interface MarkNotificationReadResponse {
  notification: Notification;
}