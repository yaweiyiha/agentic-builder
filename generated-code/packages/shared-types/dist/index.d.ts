export type SessionType = 'work' | 'break';
export interface UserSettings {
    workDuration: number;
    breakDuration: number;
    soundEnabled: boolean;
}
export interface SessionRecord {
    id: string;
    type: SessionType;
    startedAt: string;
    endedAt: string;
}
export interface AnalyticsSummary {
    completedWorkSessions: number;
    completedBreakSessions: number;
}
