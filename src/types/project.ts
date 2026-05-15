/**
 * Shared project types used across API and UI.
 */
export interface Project {
  id: string;
  slug: string;
  name: string;
  createdAt: string; // ISO string
}
