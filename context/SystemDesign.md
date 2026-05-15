# System Design: Task Management Platform

## 1. High-Level Architecture

### 1.1 Architecture Diagram
```
┌──────────────────────────────┐
│       CLIENT PLANE           │
│   React + Next.js Frontend   │
└──────────┬───────────────────┘
           │ HTTPS / WSS
┌──────────▼───────────────────┐
│     APPLICATION PLANE        │
│ AuthSvc │ TaskSvc │ NotifSvc │
│ FileSvc │ SearchSvc          │
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│        DATA PLANE            │
│ PostgreSQL │ Redis │ S3      │
│ Elasticsearch │ RabbitMQ     │
└──────────────────────────────┘
```

## 2. Core System Flows

### 2.1 Realtime Collaboration
1. **User Action**: A user updates a task status on the frontend.
2. **Frontend**: Sends the update via WebSocket to Task Service.
3. **Task Service**: Validates and updates the task in PostgreSQL.
4. **Notification Service**: Publishes a notification event to RabbitMQ.
5. **RabbitMQ**: Delivers the event to Notification Service.
6. **Notification Service**: Sends a real-time update to all connected clients via WebSocket.
7. **Frontend**: Receives the update and reflects it in the UI.

**Latency Budget**: 
- P50: 100ms
- P99: 300ms

**Error Handling**: If the WebSocket connection fails, fallback to HTTP polling every 5 seconds.

### 2.2 File Upload & Version History
1. **User Action**: A user uploads a file to a task.
2. **Frontend**: Sends the file to File Service.
3. **File Service**: Uploads the file to AWS S3 and stores metadata in PostgreSQL.
4. **PostgreSQL**: Records the file version and metadata.
5. **Frontend**: Updates the task detail view with the new file entry.

**Latency Budget**: 
- P50: 200ms
- P99: 500ms

**Error Handling**: If the upload fails, retry up to 3 times with exponential backoff.

### 2.3 Search Pipeline
1. **User Action**: A user performs a search query.
2. **Frontend**: Sends the query to Search Service.
3. **Search Service**: Queries Elasticsearch for matching tasks/projects.
4. **Elasticsearch**: Returns search results.
5. **Search Service**: Sends results back to the frontend.
6. **Frontend**: Displays search results to the user.

**Latency Budget**: 
- P50: 150ms
- P99: 400ms

**Error Handling**: If Elasticsearch is unavailable, show a cached result set using Redis.

## 3. Conflict Resolution / Consistency Strategy

| Scenario                | Behavior                                      | User Experience                        |
|-------------------------|-----------------------------------------------|----------------------------------------|
| Concurrent Task Updates | Last write wins with version control          | Users see the latest update immediately|
| File Upload Conflicts   | Versioning with timestamp-based conflict alert| Users are notified of version conflicts|
| Search Index Lag        | Eventual consistency with delay notifications | Users may see slight delays in indexing|

## 4. Rendering / Processing Pipeline

- **Layers**: UI Components (React), Data Layer (Redux)
- **Caching Strategy**: Use React Query for data fetching and caching
- **GPU/CPU Split**: Primarily CPU-bound; no significant GPU processing
- **Level of Detail (LOD)**: Not applicable

## 5. Scalability & Deployment

### 5.1 Kubernetes / Container Architecture

| Service        | Replicas min/max | HPA Trigger                     | Notes                               |
|----------------|------------------|---------------------------------|-------------------------------------|
| Auth Service   | 2/10             | CPU > 70% or Memory > 75%       | Handles user authentication         |
| Task Service   | 2/15             | CPU > 70% or Memory > 75%       | Manages task CRUD operations        |
| Notification Service | 2/10       | CPU > 70% or Message Queue Depth| Manages real-time notifications     |
| File Service   | 2/5              | CPU > 70% or Memory > 75%       | Handles file uploads                |
| Search Service | 2/5              | CPU > 70% or Query Latency > 200ms | Manages search queries              |

### 5.2 Self-Host Profiles

- **Minimal**: Single instance of each service, suitable for development.
- **Standard**: 2 instances of each service, suitable for small teams.
- **Production**: Auto-scaled instances with load balancing, suitable for large deployments.

## 6. Observability

| Signal          | Tool     | Key Metrics                     |
|-----------------|----------|---------------------------------|
| Logs            | Datadog  | Error rates, request logs       |
| Metrics         | Datadog  | CPU, Memory, Request Latency    |
| Traces          | Datadog  | Request tracing across services |
| Alerts          | Datadog  | High error rates, latency spikes|

## 7. Data Flow Diagram

1. **User Action**: User interacts with the frontend.
2. **API Call**: Frontend makes API calls to the backend services.
3. **Data Processing**: Backend services process the request and interact with the data plane.
4. **Database Update**: Data is stored or updated in PostgreSQL.
5. **Cache Update**: Frequently accessed data is cached in Redis.
6. **Search Index Update**: Data changes are indexed in Elasticsearch.
7. **File Storage**: Files are stored in AWS S3 with metadata in PostgreSQL.
8. **Notification Queue**: Events are queued in RabbitMQ for notification processing.
9. **User Feedback**: Frontend updates the UI with the latest data.

## Rules

- **Service Names & Tech Choices**: All services are named as per their primary function, e.g., Task Service, and use technologies specified in the TRD.
- **Trade-offs**: 
  - WebSockets provide low-latency updates but require persistent connections, which can be resource-intensive.
  - Using PostgreSQL ensures data integrity but may have higher latency compared to NoSQL for some operations.
  - AWS S3 offers scalable storage but incurs latency due to network calls.

- **Latency Budgets**: 
  - Realtime updates aim for P50 of 100ms and P99 of 300ms.
  - File uploads target P50 of 200ms and P99 of 500ms.
  - Search queries aim for P50 of 150ms and P99 of 400ms.

- **Diagrams**: All diagrams are presented in ASCII format for clarity and accessibility.