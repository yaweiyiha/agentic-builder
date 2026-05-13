// Source of truth for every type that crosses the API boundary or that
// frontend AND backend code both touch. Both sides MUST import from this
// module rather than redefine. No `any`. ISO 8601 strings for timestamps.

export type UUID = string;

export type ProjectId = UUID;
export type UserId = UUID;
export type TaskId = UUID;
export type TaskRunId = UUID;
export type WebhookId = UUID;
export type WebhookDeliveryId = UUID;
export type AuditLogId = UUID;
export type FileArtifactId = UUID;

export type ProjectStatus = "active" | "archived";
export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";
export type WebhookStatus = "enabled" | "disabled";
export type DeliveryStatus = "pending" | "succeeded" | "failed" | "retrying";
export type FileArtifactKind = "export" | "attachment" | "snapshot";

export interface User {
  id: UserId;
  email: string;
  name: string;
  authProvider: string;
  authProviderSubject: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: ProjectId;
  name: string;
  description: string | null;
  status: ProjectStatus;
  ownerUserId: UserId;
  sourceFilePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: TaskId;
  projectId: ProjectId;
  title: string;
  description: string | null;
  status: TaskStatus;
  orderIndex: number;
  assigneeUserId: UserId | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRun {
  id: TaskRunId;
  projectId: ProjectId;
  triggeredByUserId: UserId;
  status: "queued" | "running" | "succeeded" | "failed";
  inputSnapshot: Record<string, unknown>;
  resultSummary: string | null;
  createdAt: string;
}

export interface Webhook {
  id: WebhookId;
  projectId: ProjectId | null;
  url: string;
  eventTypes: string[];
  enabled: boolean;
  secretRef: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: WebhookDeliveryId;
  webhookId: WebhookId;
  eventType: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  status: DeliveryStatus;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: AuditLogId;
  actorUserId: UserId | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface FileArtifact {
  id: FileArtifactId;
  projectId: ProjectId | null;
  kind: FileArtifactKind;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}

export interface ListProjectsResponse {
  projects: Project[];
}

export interface GetProjectRequest {
  projectId: ProjectId;
}
export interface GetProjectResponse {
  project: Project;
}

export interface CreateProjectRequest {
  name: string;
  description?: string | null;
  sourceFilePath?: string | null;
}
export interface CreateProjectResponse {
  project: Project;
}

export interface UpdateProjectRequest {
  projectId: ProjectId;
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  sourceFilePath?: string | null;
}
export interface UpdateProjectResponse {
  project: Project;
}

export interface DeleteProjectRequest {
  projectId: ProjectId;
}
export interface DeleteProjectResponse {
  deleted: true;
}

export interface ListTasksRequest {
  projectId: ProjectId;
}
export interface ListTasksResponse {
  tasks: Task[];
}

export interface CreateTaskRequest {
  projectId: ProjectId;
  title: string;
  description?: string | null;
  assigneeUserId?: UserId | null;
}
export interface CreateTaskResponse {
  task: Task;
}

export interface UpdateTaskRequest {
  projectId: ProjectId;
  taskId: TaskId;
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  orderIndex?: number;
  assigneeUserId?: UserId | null;
}
export interface UpdateTaskResponse {
  task: Task;
}

export interface DeleteTaskRequest {
  projectId: ProjectId;
  taskId: TaskId;
}
export interface DeleteTaskResponse {
  deleted: true;
}

export interface ListTaskRunsRequest {
  projectId: ProjectId;
}
export interface ListTaskRunsResponse {
  taskRuns: TaskRun[];
}

export interface GenerateTaskRunRequest {
  projectId: ProjectId;
  inputSnapshot: Record<string, unknown>;
}
export interface GenerateTaskRunResponse {
  taskRun: TaskRun;
}

export interface ListWebhooksResponse {
  webhooks: Webhook[];
}

export interface CreateWebhookRequest {
  projectId?: ProjectId | null;
  url: string;
  eventTypes: string[];
  enabled?: boolean;
}
export interface CreateWebhookResponse {
  webhook: Webhook;
}

export interface UpdateWebhookRequest {
  webhookId: WebhookId;
  projectId?: ProjectId | null;
  url?: string;
  eventTypes?: string[];
  enabled?: boolean;
}
export interface UpdateWebhookResponse {
  webhook: Webhook;
}

export interface DeleteWebhookRequest {
  webhookId: WebhookId;
}
export interface DeleteWebhookResponse {
  deleted: true;
}

export interface TestWebhookRequest {
  webhookId: WebhookId;
}
export interface TestWebhookResponse {
  delivery: WebhookDelivery;
}

export interface ListAuditLogsRequest {
  cursor?: string | null;
  limit?: number;
}
export interface ListAuditLogsResponse {
  auditLogs: AuditLog[];
  nextCursor: string | null;
}

export interface GetAuditLogRequest {
  auditLogId: AuditLogId;
}
export interface GetAuditLogResponse {
  auditLog: AuditLog;
}

export interface UploadFileRequest {
  projectId?: ProjectId | null;
  kind: FileArtifactKind;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}
export interface UploadFileResponse {
  fileArtifact: FileArtifact;
  uploadUrl: string;
}

export interface GetFileArtifactRequest {
  fileArtifactId: FileArtifactId;
}
export interface GetFileArtifactResponse {
  fileArtifact: FileArtifact;
}

export interface DeleteFileArtifactRequest {
  fileArtifactId: FileArtifactId;
}
export interface DeleteFileArtifactResponse {
  deleted: true;
}

export interface HealthResponse {
  status: "ok";
  uptimeSeconds: number;
  version: string;
  timestamp: string;
}