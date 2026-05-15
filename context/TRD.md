# Technical Requirements Document: Task Management Platform

## 1. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend Framework | React 18 | React provides a component-based architecture, facilitating the development of reusable UI components necessary for dynamic task management features. |
| Rendering | Next.js 13 | Next.js offers server-side rendering and static site generation, crucial for SEO and performance, especially for public pages like the landing page. |
| State Management | Redux Toolkit | Redux provides a predictable state container, essential for managing global state such as user sessions and workspace data across the application. |
| Realtime Transport | WebSockets via Socket.IO | Enables real-time updates for task status changes and notifications, enhancing collaborative features. |
| Backend Framework | Node.js with Express | Provides a non-blocking, event-driven architecture suitable for handling numerous I/O operations typical in web applications. |
| Primary Database | PostgreSQL 14 | Offers robust ACID transactions and supports complex queries, essential for managing relational data like tasks, users, and workspaces. |
| Cache | Redis | Provides in-memory data storage for caching frequently accessed data, improving response times for dashboard and list views. |
| Object Storage | AWS S3 | Used for storing user-uploaded files and attachments, ensuring scalability and reliability. |
| Search | Elasticsearch | Facilitates full-text search capabilities for tasks and projects, enhancing the user experience with fast and relevant search results. |
| Auth | Auth0 | Provides secure, scalable authentication and authorization, reducing the complexity of managing user credentials. |
| Plugin/Extension Runtime | N/A | No plugin system in v1.0 as per non-goals. |
| Message Queue | RabbitMQ | Handles asynchronous task processing and notification delivery, ensuring reliability and scalability of background jobs. |
| CDN/Edge | Cloudflare | Provides fast content delivery and DDoS protection, improving global accessibility and security. |
| Infrastructure | AWS (EC2, RDS, S3, CloudFront) | Offers scalable and reliable infrastructure suitable for a growing startup, with easy integration of services. |
| Observability | Datadog | Provides comprehensive monitoring and logging, crucial for maintaining application health and performance. |
| CI/CD | GitHub Actions | Automates testing and deployment processes, ensuring consistent and reliable releases. |

## 2. Frontend Architecture

### 2.1 Application Shell
- **Type**: Single Page Application (SPA) using Next.js.
- **Code-Split Routes**: Leverage Next.js dynamic imports to load components on-demand, reducing initial load times.
- **Primary Zones**: 
  - Public: Landing, Sign Up, Login.
  - Authenticated: Dashboard, Projects, Tasks, Settings.

### 2.2 Rendering Pipeline
- **Layers**: 
  - UI Components: Built with React components.
  - Data Layer: Managed by Redux for state consistency.
- **Scene Graph**: Not applicable.
- **Dirty Tracking**: Utilized by React's virtual DOM diffing for efficient updates.

### 2.3 State Management & Realtime
- **Local State**: Managed by React hooks for component-specific state.
- **Global State**: Managed using Redux Toolkit for shared state like user sessions.
- **Realtime Updates**: Implemented using Socket.IO for task updates and notifications.
- **Undo/Redo**: Basic undo/redo implemented for task status changes using Redux middleware.

### 2.4 Plugin / Extension SDK
- **Runtime**: Not applicable in v1.0.
- **Sandboxing**: Not applicable.
- **Capability-Gated API Namespaces**: Not applicable.

## 3. Backend Architecture

### 3.1 Services

| Service | Responsibility | Tech |
|---------|---------------|------|
| Auth Service | Manages user authentication and authorization | Auth0 |
| Task Service | Handles CRUD operations for tasks | Node.js, Express, PostgreSQL |
| Notification Service | Manages real-time notifications | Node.js, RabbitMQ, Socket.IO |
| File Service | Manages file uploads and storage | Node.js, AWS S3 |
| Search Service | Provides search capabilities | Elasticsearch |

### 3.2 Data Models

- **User**: 
  - Columns: `id`, `name`, `email`, `password_hash`, `avatar_url`, `created_at`, `updated_at`
  - Notes: Passwords hashed using bcrypt.
- **Workspace**: 
  - Columns: `id`, `name`, `owner_id`, `created_at`, `updated_at`
  - Notes: Owner is a foreign key to User.
- **Project**: 
  - Columns: `id`, `workspace_id`, `name`, `description`, `color`, `status`, `created_at`, `updated_at`
  - Notes: Belongs to a Workspace.
- **Task**: 
  - Columns: `id`, `project_id`, `title`, `description`, `assignee_id`, `status`, `priority`, `due_date`, `created_at`, `updated_at`
  - Notes: Supports labeling and activity tracking.
- **Comment**: 
  - Columns: `id`, `task_id`, `user_id`, `body`, `created_at`
  - Notes: Stores task-related comments.
- **ActivityLog**: 
  - Columns: `id`, `task_id`, `action`, `user_id`, `timestamp`
  - Notes: Logs key actions for tasks.
- **Notification**: 
  - Columns: `id`, `user_id`, `type`, `reference_id`, `read`, `created_at`
  - Notes: Tracks notification events.
- **Invite**: 
  - Columns: `id`, `workspace_id`, `email`, `role`, `status`, `inviter_id`, `expiration_date`
  - Notes: Manages workspace invitations.

### 3.3 API Specification Summary

| Group | Base Path | Key Endpoints |
|-------|-----------|---------------|
| Auth | `/api/auth` | `/login`, `/signup`, `/logout`, `/reset-password` |
| Workspace | `/api/workspaces` | `/`, `/:id`, `/invite` |
| Project | `/api/projects` | `/`, `/:id`, `/archive` |
| Task | `/api/tasks` | `/`, `/:id`, `/comments`, `/activity` |
| Notification | `/api/notifications` | `/`, `/:id/read` |
| File | `/api/files` | `/upload`, `/:id/download` |

### 3.4 File / Data Format
- **File Uploads**: JSON metadata with file references stored in S3.
- **Data Serialization**: JSON for API responses.
- **Schema Versioning**: Use of `version` field in API headers to manage backward compatibility.

## 4. Security Requirements

| Area | Requirement | Implementation |
|------|------------|----------------|
| Auth | Passwords must be securely hashed | Bcrypt with a minimum cost factor of 12 |
| Authz | Role-based access control for resources | Implemented via middleware checking user roles |
| Transport | All data must be transmitted over HTTPS | Enforced via SSL/TLS configuration |
| Plugin Sandbox | N/A | N/A |
| Upload Validation | Validate file types and sizes before upload | Implemented via middleware on upload endpoints |
| Injection Prevention | Protect against SQL/NoSQL injection | Use of parameterized queries and ORM |
| CSRF | Protect against CSRF attacks | Use of CSRF tokens in forms |
| Secrets Management | Secure handling of API keys and secrets | Use of environment variables and AWS Secrets Manager |
| Audit Logging | Maintain logs of key actions | Use of ActivityLog model and centralized logging with Datadog |

## 5. Non-Functional Targets

| Category | Metric | Target |
|----------|--------|--------|
| Performance | Page Load Time | < 3 seconds on standard broadband |
| Scalability | Concurrent Users | Support up to 10,000 concurrent users |
| Availability | Uptime | 99.9% uptime SLA |
| Browser Support | Compatibility | Latest 2 versions of Chrome, Safari, Edge, Firefox |

## Architecture Diagram

```plaintext
+-----------------------+
|       Frontend        |
|-----------------------|
|    React + Next.js    |
+-----------------------+
        |
        v
+-----------------------+
|       Backend         |
|-----------------------|
| Node.js + Express     |
+-----------------------+
        |
        v
+-----------------------+
|    Database Layer     |
|-----------------------|
|     PostgreSQL        |
+-----------------------+
        |
        v
+-----------------------+
|    Cache & Search     |
|-----------------------|
| Redis + Elasticsearch |
+-----------------------+
        |
        v
+-----------------------+
|  File & Message Queue |
|-----------------------|
| AWS S3 + RabbitMQ     |
+-----------------------+
```

This diagram illustrates the high-level architecture of the Task Management Platform, showing the flow from frontend to backend, database, and additional services like caching, search, file storage, and messaging.

This document provides a comprehensive guide for engineering teams to implement the Task Management Platform, ensuring alignment with the PRD and addressing both functional and non-functional requirements.