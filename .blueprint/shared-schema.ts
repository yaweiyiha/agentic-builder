// Source of truth for every type that crosses the API boundary or that
// frontend AND backend code both touch. Both sides MUST import from this
// module rather than redefine. No `any`. ISO 8601 strings for timestamps.

export type StablecoinId = string;
export type UserId = string;
export type ReviewId = string;
export type AlertId = string;
export type SnapshotId = string;
export type MetricId = string;
export type VariableId = "RQ-1" | "RQ-3" | "RQ-4" | "MC-1" | "MC-5" | "MC-8" | "OC-7" | "SE-2" | "SE-4";
export type DimensionId = "RQ" | "MC" | "OC" | "SE";
export type RiskLevel = "Normal" | "Elevated" | "High Risk" | "Critical";
export type ReviewStatus = "pending" | "manual_required" | "approved";
export type AlertType = "risk_level_change" | "rapid_mover";
export type AlertSeverity = "info" | "warning" | "critical";
export type FreshnessStatus = "fresh" | "stale" | "insufficient_history" | "no_data";
export type QueueTab = "pending" | "manual_required" | "approved";
export type TrendRange = "24h" | "7d" | "30d";
export type Role = "analyst" | "operator" | "admin";

export interface Stablecoin {
  id: StablecoinId;
  symbol: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DimensionScore {
  dimensionId: DimensionId;
  score: number;
}

export interface VariableScore {
  variableId: VariableId;
  rawValue: number | string | null;
  normalizedScore: number | null;
  ruleSummary: string;
  source: string;
  observedAt: string | null;
  status: FreshnessStatus;
}

export interface ScoreSnapshot {
  id: SnapshotId;
  stablecoinId: StablecoinId;
  computedAt: string;
  compositeScore: number;
  riskLevel: RiskLevel;
  dimensionScores: DimensionScore[];
  variableScores: VariableScore[];
  dataFreshnessStatus: FreshnessStatus;
  staleSince?: string | null;
}

export interface Alert {
  id: AlertId;
  stablecoinId: StablecoinId;
  type: AlertType;
  severity: AlertSeverity;
  variableId?: VariableId | null;
  delta?: number | null;
  message: string;
  createdAt: string;
  linkedSnapshotId?: SnapshotId | null;
}

export interface RawMetric {
  id: MetricId;
  stablecoinId: StablecoinId;
  variableId: VariableId;
  value: number | string;
  source: string;
  observedAt: string;
  freshnessStatus: FreshnessStatus;
}

export interface ReserveReview {
  id: ReviewId;
  stablecoinId: StablecoinId;
  sourceUrl: string;
  documentType: string;
  extractedValues: Record<string, unknown>;
  suggestedValues: Record<string, unknown>;
  publishedValues: Record<string, unknown> | null;
  status: ReviewStatus;
  reviewerId: UserId | null;
  reviewedAt: string | null;
  submittedAt: string;
  updatedAt: string;
}

export interface ReserveReviewAuditEvent {
  id: string;
  reserveReviewId: ReviewId;
  actorUserId: UserId | null;
  action: "extract" | "approve" | "edit_and_approve" | "reject" | "publish" | "update";
  diff: Record<string, unknown> | null;
  notes: string | null;
  createdAt: string;
}

export interface ConfigurationEntry {
  key: string;
  value: Record<string, unknown>;
  updatedBy: UserId | null;
  updatedAt: string;
}

export interface User {
  id: UserId;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardKpis {
  trackedCoins: number;
  activeAlerts: number;
  rapidMovers: number;
  lastRefreshedAt: string | null;
}

export interface StablecoinCardSummary {
  stablecoin: Stablecoin;
  compositeScore: number;
  riskLevel: RiskLevel;
  rapidMover: boolean;
  freshnessStatus: FreshnessStatus;
  dimensionScores: DimensionScore[];
}

export interface MonitorSummaryResponse {
  kpis: DashboardKpis;
  cards: StablecoinCardSummary[];
  lastRefreshedAt: string | null;
}

export interface TrendPoint {
  timestamp: string;
  stablecoinId: StablecoinId;
  symbol: string;
  compositeScore: number | null;
  riskLevel: RiskLevel | null;
}

export interface TrendResponse {
  range: TrendRange;
  series: TrendPoint[];
  riskBands: { min: number; max: number; label: RiskLevel }[];
  generatedAt: string;
}

export interface AlertFeedResponse {
  alerts: Alert[];
  generatedAt: string;
}

export interface StablecoinDetailResponse {
  stablecoin: Stablecoin;
  snapshot: ScoreSnapshot | null;
  rapidMover: boolean;
  freshnessStatus: FreshnessStatus;
  lastUpdatedAt: string | null;
  reviewStatus: ReserveReview | null;
  topDrivers: VariableScore[];
}

export interface StablecoinTrendResponse {
  symbol: string;
  range: TrendRange;
  series: TrendPoint[];
  riskBands: { min: number; max: number; label: RiskLevel }[];
  generatedAt: string;
}

export interface StablecoinVariablesResponse {
  symbol: string;
  variables: VariableScore[];
  generatedAt: string;
}

export interface StablecoinAlertsResponse {
  symbol: string;
  alerts: Alert[];
  generatedAt: string;
}

export interface ReviewQueueItem {
  review: ReserveReview;
  stablecoinSymbol: string;
  sourceDocumentLabel: string;
  aiConfidence: number;
}

export interface ReviewQueueResponse {
  tab: QueueTab;
  items: ReviewQueueItem[];
  generatedAt: string;
}

export interface ReviewDetailResponse {
  review: ReserveReview;
  stablecoin: Stablecoin;
  evidence: {
    excerpt: string;
    sourceUrl: string;
  };
  generatedAt: string;
}

export interface ApproveReviewRequest {
  reviewerNotes?: string;
}

export interface ApproveReviewResponse {
  review: ReserveReview;
  auditEvent: ReserveReviewAuditEvent;
}

export interface RejectReviewRequest {
  reviewerNotes?: string;
}

export interface RejectReviewResponse {
  review: ReserveReview;
  auditEvent: ReserveReviewAuditEvent;
}

export interface EditAndApproveReviewRequest {
  values: Record<string, unknown>;
  reviewerNotes?: string;
  expectedUpdatedAt: string;
}

export interface EditAndApproveReviewResponse {
  review: ReserveReview;
  auditEvent: ReserveReviewAuditEvent;
}

export interface DashboardTrendRequest {
  range: TrendRange;
}

export interface GetMonitorSummaryResponse {
  summary: MonitorSummaryResponse;
}

export interface GetDashboardTrendRequest {
  range: TrendRange;
}

export interface GetDashboardTrendResponse {
  trend: TrendResponse;
}

export interface GetAlertFeedResponse {
  feed: AlertFeedResponse;
}

export interface GetStablecoinDetailRequest {
  symbol: string;
}

export interface GetStablecoinDetailResponse {
  detail: StablecoinDetailResponse;
}

export interface GetStablecoinTrendRequest {
  symbol: string;
  range: TrendRange;
}

export interface GetStablecoinTrendResponse {
  trend: StablecoinTrendResponse;
}

export interface GetStablecoinVariablesRequest {
  symbol: string;
}

export interface GetStablecoinVariablesResponse {
  variables: StablecoinVariablesResponse;
}

export interface GetStablecoinAlertsRequest {
  symbol: string;
}

export interface GetStablecoinAlertsResponse {
  alerts: StablecoinAlertsResponse;
}

export interface GetReviewQueueRequest {
  tab: QueueTab;
}

export interface GetReviewQueueResponse {
  queue: ReviewQueueResponse;
}

export interface GetReviewDetailRequest {
  id: ReviewId;
}

export interface GetReviewDetailResponse {
  review: ReviewDetailResponse;
}

export interface GetSessionResponse {
  user: User | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
}

export interface LogoutResponse {
  ok: true;
}

export interface RunScoringRequest {
  stablecoinId?: StablecoinId;
  dryRun?: boolean;
}

export interface RunScoringResponse {
  runId: string;
  startedAt: string;
}

export interface GetLatestScoringResponse {
  latestSnapshot: ScoreSnapshot | null;
}

export interface GetScoringHistoryResponse {
  snapshots: ScoreSnapshot[];
}