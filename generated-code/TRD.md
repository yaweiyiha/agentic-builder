Technical Requirements Document: AeroCommerce

1. Technology Stack
   Layer Technology Rationale
   Frontend Framework (Dashboards) React 18 + Vite + TypeScript High-performance SPA for Admin/Vendor portals (FR-MVM01, FR-OMS01). Strict typing reduces runtime errors in complex dashboard UIs.
   Frontend Framework (Ref. Storefront) Next.js 14 (App Router) React Server Components and advanced edge caching to achieve <100ms catalog read latency (FR-API01, US-05).
   API Gateway / Federation Apollo Router (Rust) High-throughput GraphQL federation gateway. Aggregates subgraphs (Catalog, Cart, OMS) into a single unified schema for the storefront (US-05).
   Backend Framework (Microservices) Go 1.21 & Node.js (NestJS) Go for high-throughput, latency-sensitive services (Cart, Checkout). NestJS for complex business logic domains (PIM, OMS) where ecosystem libraries excel.
   Primary Database PostgreSQL 15 (AWS Aurora) ACID compliance for commerce transactions. Robust JSONB support for unlimited custom product attributes (FR-PIM01).
   Cache & Session Store Redis 7 (AWS ElastiCache) Sub-millisecond latency for cart persistence (FR-API02), B2B pricing tier lookups (FR-PRC03), and temporary inventory reservation locks (US-07).
   Search & Discovery Algolia Native support for vector/semantic search, typo tolerance, and faceted aggregations out-of-the-box (FR-SRC01, FR-SRC02, US-06).
   Authentication & IAM Auth0 Unified B2B/B2C identity management. Supports SSO, MFA, and role-based access control (RBAC) for Admins vs. Vendors.
   Message Queue / Event Bus Apache Kafka (AWS MSK) Durable, high-throughput event streaming for asynchronous order state processing, webhook dispatching (FR-API04), and search indexing.
   Object Storage & CDN AWS S3 + CloudFront Scalable storage for Digital Asset Management (DAM). CloudFront provides global edge caching and on-the-fly image optimization (FR-PIM04).
   Payments & Finance Stripe Connect Automated multi-vendor fund routing, split payments, and platform commission retention (FR-MVM04, US-10). PCI-DSS Level 1 compliant.
   Infrastructure & Orchestration AWS EKS (Kubernetes) Container orchestration for microservices. Supports Horizontal Pod Autoscaling (HPA) to handle 10,000 RPS peak loads (Black Friday).
   Observability Datadog Unified APM, log aggregation, and infrastructure metrics. Essential for monitoring <100ms p95 latency targets and distributed tracing.
   CI/CD GitHub Actions + ArgoCD GitOps deployment model. Ensures reproducible, automated deployments to Kubernetes clusters with zero-downtime rollouts.
2. Frontend Architecture
   Note: AeroCommerce is headless. This section defines the architecture for the Admin/Vendor Dashboards and the Reference Storefront SDK.

2.1 Application Shell
Admin & Vendor Dashboards (SPA): Built as a Single Page Application using React and Vite. The shell implements route-based code splitting (e.g., /pim, /oms, /finance) to minimize initial bundle size.
Reference Storefront (MPA/Hybrid): Built using Next.js App Router. Product Detail Pages (PDPs) and Product Listing Pages (PLPs) are statically generated (SSG) and revalidated via Incremental Static Regeneration (ISR) to hit the <100ms latency target. Cart and Checkout zones are strictly client-side rendered (CSR) to prevent caching sensitive user data.
2.2 Rendering Pipeline
Dashboards: Client-side rendering (CSR) exclusively. Uses a component library (e.g., Radix UI + Tailwind CSS) for accessible, WCAG 2.1 AA compliant interfaces.
Storefront:
Edge Layer: CloudFront intercepts requests. Cache hits return instantly.
Server Layer: Next.js React Server Components fetch data from the Apollo GraphQL Gateway.
Client Layer: Hydrates interactive islands (e.g., "Add to Cart" buttons, faceted search filters).
2.3 State Management & Realtime
Server State: TanStack React Query handles data fetching, caching, and synchronization for the dashboards. It drastically reduces boilerplate for CRUD operations in the PIM and OMS.
Local State: Zustand is used for lightweight, global client state (e.g., UI theme, sidebar toggle, transient cart state before syncing to backend).
Realtime: Server-Sent Events (SSE) are utilized in the Admin/Vendor dashboards to push live order updates (FR-OMS01) and low-inventory alerts without the overhead of bidirectional WebSockets.
2.4 Plugin / Extension SDK
Admin UI Extensions: Third-party integrations (e.g., custom ERP sync tools) can inject UI components into the Admin Dashboard via a micro-frontend architecture using Webpack Module Federation.
Sandboxing: Extensions run in isolated iframe contexts communicating with the host shell via a strictly typed postMessage RPC bridge.
Capability-Gated API: Extensions must request permissions (e.g., read:orders, write:catalog) during installation. The host shell provisions scoped short-lived JWTs for the extension to interact with the backend APIs. 3. Backend Architecture
Architecture Diagram
+-------------------+
| Web / Mobile |
| (Storefronts) |
+--------+----------+
| (GraphQL / REST)
+----------------------------------------------v---------------------------------------------+
| AWS CloudFront (CDN) |
+----------------------------------------------+---------------------------------------------+
|
+-----------v-----------+
| Apollo Router Gateway | (GraphQL Federation)
+---+-------+-------+---+
| | |
+-----------------------------+ | +-----------------------------+
| | |
+--------v---------+ +--------v---------+ +--------v---------+
| Catalog & PIM | | Cart & Checkout | | OMS & Vendor |
| Service (Go) | | Service (Go) | | Service (NestJS) |
+--------+---------+ +--------+---------+ +--------+---------+
| | |
v v v
+------------------+ +------------------+ +------------------+
| PostgreSQL (PIM) | | Redis (Sessions) | | PostgreSQL (OMS) |
+------------------+ +------------------+ +------------------+
| | |
+-------------------------------------+-------------------------------------+
|
+--------v---------+
| Kafka (MSK) | (Event Bus)
+--------+---------+
|
+-------------------------------------+-------------------------------------+
| | |
+--------v---------+ +--------v---------+ +--------v---------+
| Algolia Indexer | | Webhook Dispatch | | Stripe Connect |
| (Worker) | | (Worker) | | Integration |
+------------------+ +------------------+ +------------------+
3.1 Services
Service Responsibility Tech
API Gateway GraphQL federation, rate limiting, token validation, edge caching rules. Apollo Router (Rust)
Catalog/PIM Product CRUD, variant management, custom attributes, pricing tiers (FR-PIM01-03, FR-PRC02-03). Go, PostgreSQL, Redis
Cart/Checkout Cart sessions, inventory reservation (US-07), guest-to-auth merge (FR-API03), mixed-cart logic (FR-MVM03). Go, Redis
OMS Order state machine (FR-OMS01), tracking updates, partial fulfillments, returns (FR-OMS03-04). Node.js (NestJS), Postgres
Vendor/Finance Vendor onboarding, commission calculations (FR-MVM02), Stripe Connect routing (US-10). Node.js (NestJS), Postgres
Search Sync Consumes Kafka catalog events to update Algolia vector indices in near real-time (FR-SRC01). Go (Worker)
3.2 Data Models
Note: Models span across decentralized databases per microservice. Keys shown represent logical relationships.

Product (Catalog DB)
id (UUID, PK)
vendor_id (UUID, FK)
base_price (Decimal)
attributes (JSONB) - Stores unlimited custom attributes (FR-PIM01).
status (Enum: Draft, Scheduled, Published) - (FR-PIM05).
Variant (Catalog DB)
id (UUID, PK)
product_id (UUID, FK)
sku (String, Unique)
inventory_count (Int)
Order (OMS DB)
id (UUID, PK)
customer_id (UUID, FK, Nullable for Guests)
status (Enum: Pending, Paid, Processing, Shipped, Delivered, Canceled, Refunded) - (FR-OMS01).
total_amount (Decimal)
SubOrder (OMS DB)
id (UUID, PK)
parent_order_id (UUID, FK)
vendor_id (UUID, FK) - Enables mixed carts and separate vendor fulfillment (FR-MVM03).
platform_commission (Decimal)
B2B_Pricing_Rule (Catalog DB)
id (UUID, PK)
customer_group_id (UUID, FK)
product_id (UUID, FK)
min_quantity (Int) - Supports volume-based tiered pricing (FR-PRC03).
discount_percentage (Decimal)
3.3 API Specification Summary
Group Base Path Key Endpoints / GraphQL Operations
Storefront /graphql query GetProduct($id), mutation AddToCart($input), mutation Checkout($input)
PIM Admin /api/v1/admin/catalog POST /products (Create), POST /products/bulk-import (CSV/JSON upload)
Vendor /api/v1/vendor GET /orders (Vendor-scoped), PUT /orders/{id}/tracking (Add tracking)
B2B /api/v1/b2b POST /rfq (Submit RFQ from cart), GET /contracts
Webhooks /api/v1/webhooks POST /stripe (Payment intents, Connect onboarding), POST /auth0
3.4 File / Data Format
Bulk Import/Export: Supports CSV and JSONL (JSON Lines) formats for large catalog imports (FR-PIM03).
Schema Validation: JSON imports are validated against JSON Schema definitions using AJV before processing.
Versioning: REST APIs use URI versioning (/v1/). GraphQL uses schema evolution (deprecating fields via @deprecated directives rather than versioning). 4. Security Requirements
Area Requirement Implementation
Authentication Secure B2B/B2C and Admin access. Auth0 JWTs. Storefront uses short-lived access tokens. Admin portal enforces MFA.
Authorization Strict data isolation between Vendors. RBAC middleware. Vendor API requests automatically append vendor_id from JWT to all DB queries to prevent IDOR.
PCI Compliance No credit card data touches our servers. Stripe Elements (Frontend) + Stripe Payment Intents API (Backend). Systems only store opaque Stripe tokens (PCI-DSS Level 1).
Rate Limiting Prevent DDoS and brute-force attacks. Redis Token Bucket algorithm at the API Gateway. 100 req/min/IP for public endpoints; 1000 req/min for authenticated B2B API keys.
Injection Prevention Protect against SQL/NoSQL injection. All microservices use parameterized queries via ORMs (GORM for Go, Prisma for NestJS).
CSRF Protection Prevent cross-site request forgery on dashboards. SameSite=Strict cookies for session management + Anti-CSRF tokens for all state-mutating REST endpoints.
Data Privacy (GDPR/CCPA) Right to be forgotten and data export. Automated /api/v1/privacy/anonymize endpoint that obfuscates PII in the Customer and Order tables while retaining financial aggregates.
Secrets Management No hardcoded secrets. AWS Secrets Manager injects environment variables into EKS pods at runtime. 5. Non-Functional Targets
Category Metric Target Implementation Strategy
Performance Edge-cached Read Latency (p95) < 100ms CloudFront caching for image assets and Apollo Router @cacheControl directives for static catalog queries.
Performance Transactional Write Latency (p95) < 500ms Async processing via Kafka. Checkout mutation returns immediately after writing to Redis and publishing an OrderPlaced event.
Scalability Peak Throughput 10,000 RPS Kubernetes Horizontal Pod Autoscaler (HPA) scales pods based on CPU > 70%. Aurora Serverless v2 scales DB compute dynamically.
Availability Platform Uptime 99.99% Multi-AZ deployment in AWS. Circuit breakers (Resilience4j/Go equivalent) prevent cascading failures if a third-party API (e.g., Shippo) goes down.
Data Consistency Inventory Accuracy Strict Consistency Redis distributed locks (Redlock) reserve inventory during the checkout flow (US-07) to prevent overselling.
Browser Support Admin Dashboard Compatibility Modern Browsers Support for latest 2 versions of Chrome, Firefox, Safari, Edge. Polyfills omitted to reduce bundle size.
