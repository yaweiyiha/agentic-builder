System Design: AeroCommerce

1. High-Level Architecture
   AeroCommerce employs a headless, microservices-based architecture deployed on AWS EKS. It separates the presentation layer (Client Plane) from the business logic (Application Plane) and state management (Data Plane). The system uses Apollo Router as a federated GraphQL gateway to unify disparate backend domains (Catalog, Cart, OMS) into a single, cohesive API for the frontends.

Trade-off considered: GraphQL Federation vs. Monolithic GraphQL Server. Federation introduces operational complexity and slight inter-service latency but was chosen to allow independent scaling and deployment of the high-traffic Catalog service (Go) vs. the complex, workflow-heavy OMS service (NestJS).

1.1 Architecture Diagram
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT PLANE │
│ │
│ ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐ │
│ │ B2C/B2B Storefront │ │ Admin Dashboard │ │ Vendor Dashboard │ │
│ │ (Next.js 14) │ │ (React 18/Vite) │ │ (React 18/Vite) │ │
│ └─────────┬──────────┘ └─────────┬──────────┘ └─────────┬──────────┘ │
└────────────┼────────────────────────┼────────────────────────┼──────────────┘
│ HTTPS / GraphQL │ HTTPS / REST │ HTTPS / REST
┌────────────▼────────────────────────▼────────────────────────▼──────────────┐
│ EDGE TIER │
│ ┌───────────────────────────────────────────────────────────────────────┐ │
│ │ AWS CloudFront (CDN & Edge Caching) + AWS WAF (Rate Limiting) │ │
│ └──────────────────────────────────┬────────────────────────────────────┘ │
└─────────────────────────────────────┼───────────────────────────────────────┘
│ GraphQL / REST
┌─────────────────────────────────────▼───────────────────────────────────────┐
│ APPLICATION PLANE │
│ ┌───────────────────────────────────────────────────────────────────────┐ │
│ │ Apollo Router (Rust) - GraphQL Federation Gateway & Auth Token Val. │ │
│ └─┬──────────────────────┬──────────────────────┬─────────────────────┬─┘ │
│ │ gRPC / GraphQL │ gRPC / GraphQL │ REST │ │
│ ┌──▼────────────────┐ ┌──▼────────────────┐ ┌──▼────────────────┐ ┌─▼──┐ │
│ │ Catalog & PIM │ │ Cart & Checkout │ │ OMS & Vendor │ │ AI │ │
│ │ Service (Go) │ │ Service (Go) │ │ Service (NestJS) │ │ Srch││
│ └─┬───────────────┬─┘ └─┬───────────────┬─┘ └─┬───────────────┬─┘ └─┬──┘ │
└───┼───────────────┼──────┼───────────────┼──────┼───────────────┼──────┼────┘
│ │ │ │ │ │ │
┌───▼───────────────▼──────▼───────────────▼──────▼───────────────▼──────▼────┐
│ DATA PLANE │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────┐ │
│ │ PostgreSQL │ │ Redis 7 │ │ Kafka (MSK) │ │ AWS S3 │ │Algolia│ │
│ │ (Aurora v2) │ │ (ElastiCache│ │ (Event Bus) │ │ (DAM/Assets)│ │(Index)│ │
│ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └───────┘ │
└─────────────────────────────────────────────────────────────────────────────┘ 2. Core System Flows
2.1 Primary Flow: Multi-Vendor Checkout & Payment Routing
This flow handles a shopper checking out with a "mixed cart" containing items from multiple vendors, reserving inventory, processing payment via Stripe Connect, and splitting the order.

Steps:

Initiate Checkout: Client calls mutation Checkout($input) via Apollo Router.
Inventory Lock: Cart Service (Go) attempts to acquire a distributed lock in Redis for the requested SKUs.
Trade-off: Redis Redlock ensures strict consistency to prevent overselling (US-07) but adds a slight latency penalty compared to optimistic concurrency. Chosen because overselling damages vendor trust.
Price Validation: Cart Service fetches current pricing from Catalog Service to ensure no price tampering.
Payment Intent: Cart Service calls Stripe API to create a PaymentIntent, passing vendor routing details (split amounts minus platform commission).
Client Payment: Client securely submits card details directly to Stripe Elements (PCI-DSS Level 1 compliance).
Webhook Confirmation: Stripe sends a payment_intent.succeeded webhook to the API Gateway.
Order Creation: Webhook Dispatch Worker validates the Stripe signature and publishes a PaymentSucceeded event to Kafka.
Sub-Order Splitting: OMS Service (NestJS) consumes the event, reads the cart state, and generates one Parent Order and multiple SubOrder records in PostgreSQL, one for each vendor (FR-MVM03).
Notification: OMS triggers transactional emails via SendGrid and publishes an OrderCreated event.
Latency Budget:

P50: 300ms (excluding 3rd-party Stripe network time).
P99: 800ms.
Error Handling: If Redis lock fails (out of stock), return INVENTORY_UNAVAILABLE immediately. If Stripe fails, retain cart in Redis and return PAYMENT_FAILED (US-08).
2.2 Secondary Flow: B2B Catalog Browsing & AI Search
This flow handles a B2B buyer searching for products and viewing their specific negotiated pricing tiers.

Steps:

Search Query: Client types "jogging shoes" into the Next.js storefront.
Edge Cache Check: Request hits CloudFront. If a cached response for this exact query and user group exists, return immediately.
Vector Search: Apollo Router routes the query to the AI Search Service, which queries Algolia's vector database. Algolia applies typo tolerance ("sneekers") and semantic matching (US-06).
Hydration: Search Service returns a list of Product IDs. Apollo Router federates a query to the Catalog Service (Go) to fetch product details.
Dynamic Pricing: Catalog Service checks the user's JWT for a customer_group_id. It queries Redis for B2B pricing rules (FR-PRC02, FR-PRC03) and applies the volume discount overlay to the base prices.
Response: Apollo Router stitches the search results and dynamic prices together and returns the GraphQL response.
Latency Budget:

P50: 45ms (Cache Hit) / 120ms (Cache Miss).
P99: < 250ms.
Error Handling: If Algolia is down, fallback to a basic PostgreSQL ILIKE or tsvector text search in the Catalog Service.
2.3 Tertiary Flow: Bulk Product Import & Search Sync
This flow handles a Vendor uploading a CSV of 500 products (US-02) and syncing them to the search index.

Steps:

Upload: Vendor uploads a CSV via the React Dashboard. The file is streamed directly to AWS S3 using a pre-signed URL to avoid tying up the API Gateway.
Trigger: Dashboard calls POST /products/bulk-import with the S3 object key.
Ingestion: Catalog Service reads the file from S3, validates the JSON Schema/CSV headers, and writes products to PostgreSQL in batches.
Event Emission: For each successful batch, Catalog Service publishes ProductCreated events to Kafka.
Search Sync: The Algolia Indexer Worker (Go) consumes the Kafka topic, formats the data into Algolia's required JSON structure, and pushes updates to the Algolia Index via their API.
Latency Budget:

P50: Async (Processed at ~1000 rows/second).
P99: < 5 seconds total for 500 items to appear in search.
Error Handling: Dead Letter Queue (DLQ) in Kafka for malformed rows. The Vendor Dashboard polls an import status endpoint to display partial success/failure logs. 3. Conflict Resolution / Consistency Strategy
In a distributed e-commerce system, balancing high availability with strict consistency is critical, especially regarding inventory and pricing.

Scenario Behavior / Resolution Strategy User Experience
Concurrent Checkout (Inventory Oversell) Strict Consistency: Redis distributed locks (Redlock) are acquired when the user clicks "Proceed to Checkout". Lock TTL is 15 minutes. User B sees "Only 1 left in stock" but receives an "Item no longer available" error if User A is already in checkout.
Mixed Cart Payment Failure Eventual Consistency with Rollback: If Stripe payment fails, the Kafka PaymentFailed event triggers the Cart Service to release the Redis inventory lock. "Payment failed. Your cart has been saved. Please try another payment method."
B2B Pricing Update vs. Active Cart Snapshot Isolation: Cart prices are snapshotted when the item is added. If a B2B admin changes the tier pricing, the cart retains the old price until the 15-minute session expires or the cart is modified. Price is guaranteed for the duration of the active session, preventing mid-checkout price jumps.
Network Partition (OMS DB Down) Asynchronous Durability: Stripe webhooks are acknowledged by the Gateway and pushed to Kafka. If OMS PostgreSQL is down, Kafka retains the events (7-day retention). Order is placed successfully. Confirmation email is slightly delayed until OMS recovers and processes the Kafka backlog.
Vendor Edits Product during Checkout Immutable Order Lines: Once an order is placed, the SubOrder line items copy the product attributes (name, price, SKU) as JSON. Future catalog edits do not mutate historical orders. Shopper's receipt reflects the exact product state at the time of purchase.
Trade-off considered: We chose Eventual Consistency (via Kafka) for order state processing to ensure the checkout mutation returns in <500ms. Strict consistency is only enforced at the inventory reservation boundary.

4. Rendering / Processing Pipeline
   AeroCommerce utilizes a hybrid rendering pipeline to achieve the <100ms P95 latency target for catalog reads while maintaining secure, dynamic checkout flows.

4.1 Storefront Rendering (Next.js 14)
Edge Layer (CloudFront): Caches static assets, images, and fully static pages.
Static Site Generation (SSG) + ISR: Product Listing Pages (PLPs) and Product Detail Pages (PDPs) are pre-rendered at build time. Incremental Static Regeneration (ISR) revalidates these pages in the background every 60 seconds.
Trade-off: ISR means a user might see a 60-second stale product description. This is acceptable for text/images, whereas inventory and pricing are fetched dynamically client-side.
React Server Components (RSC): Used for fetching heavy catalog data directly from the Apollo Gateway without sending JavaScript to the client, reducing Time to Interactive (TTI).
Client-Side Hydration (CSR): "Islands of interactivity" like the Cart drawer, B2B pricing overlays, and Checkout flow are rendered client-side using Zustand for state and TanStack Query for fetching.
4.2 Asset & Image Pipeline (DAM)
Storage: High-res images uploaded by vendors are stored in an S3 bucket (s3://aerocommerce-assets-raw).
Processing: CloudFront Image Optimization is used on-the-fly. When a Next.js next/image component requests an image, CloudFront resizes, compresses (to WebP/AVIF), and caches the asset at the edge based on the requesting device's viewport.
4.3 Dashboard Rendering (React 18 / Vite)
Client-Side Rendering (CSR): The Admin and Vendor dashboards are strictly CSR. SEO is not a requirement here, and CSR allows for highly interactive, app-like experiences.
Micro-Frontends: Webpack Module Federation allows third-party plugins (e.g., an ERP sync tool) to inject UI components into the Admin dashboard at runtime, sandboxed via iframe and a postMessage RPC bridge. 5. Scalability & Deployment
The platform is deployed on AWS Elastic Kubernetes Service (EKS) using a GitOps model (GitHub Actions + ArgoCD) to ensure zero-downtime rolling updates.

5.1 Kubernetes / Container Architecture
Service Replicas (Min/Max) HPA Trigger Notes
Apollo Router Gateway 3 / 20 CPU > 60% Rust-based, highly efficient. Scales rapidly to absorb traffic spikes.
Catalog & PIM (Go) 3 / 30 CPU > 70% Read-heavy. Aurora Serverless v2 scales DB compute underneath automatically.
Cart & Checkout (Go) 3 / 50 CPU > 70%, Mem > 80% High priority during Black Friday. Relies heavily on ElastiCache (Redis).
OMS & Vendor (NestJS) 2 / 15 CPU > 75% Workflow-heavy, lower RPS than catalog. Handles complex commission math.
Search Sync Worker 1 / 10 Kafka Lag > 1000 msgs Scales based on custom Datadog external metrics (Kafka topic lag) rather than CPU.
Webhook Dispatch Worker 2 / 20 Kafka Lag > 500 msgs Critical for processing Stripe payments. High scale-out limit.
Trade-off considered: Over-provisioning minimum replicas (3) for core services ensures high availability across AWS Availability Zones (AZs) at the cost of baseline infrastructure spend.

5.2 Self-Host / Deployment Profiles
To support different tiers of enterprise clients, AeroCommerce defines three infrastructure profiles via Helm charts:

Minimal (Dev / QA):
Bundles Postgres and Redis as local K8s StatefulSets instead of managed AWS services.
Single replica per service. No Kafka (uses simple Redis Pub/Sub for events).
Use case: Local developer environments and CI integration testing.
Standard (Mid-Market):
Managed AWS Aurora (Provisioned) and ElastiCache.
Kafka MSK Serverless.
2-5 replicas per service.
Use case: Standard B2B/B2C merchants with predictable traffic.
Production (Enterprise / Peak Load):
AWS Aurora Serverless v2 (scales instantly).
Dedicated Kafka MSK cluster with multi-AZ replication.
Multi-region CloudFront edge caching.
Use case: Flash sales, Black Friday, >$5M GMV merchants. 6. Observability
Achieving the 99.99% uptime and <100ms latency targets requires deep, unified observability. Datadog is utilized across the stack.

Signal Tool Key Metrics Monitored Alerting Threshold
APM / Tracing Datadog APM End-to-end request latency, DB query execution time. P95 Latency > 200ms (Warning), > 500ms (Critical).
Infrastructure Datadog Infra EKS Node CPU/Memory, Pod restarts, HPA scaling events. Pod CrashLoopBackOff > 3 in 10 mins.
Logs Datadog Logs Application errors, Webhook signature failures, Auth errors. Error Rate > 1% of total RPS.
Database AWS RDS Insights Aurora active sessions, Deadlocks, Query wait times. DB CPU > 80%, Deadlock count > 0.
Messaging Datadog Kafka Consumer group lag, Topic partition distribution. Kafka Lag > 5000 messages (Delayed orders).
RUM / Frontend Datadog RUM Core Web Vitals (LCP, FID, CLS), JS error rates, Checkout drop-off. LCP > 2.5s, Unhandled JS Exception spike.
Trade-off considered: Datadog is expensive at scale. To manage costs, we sample APM traces at 100% for errors and checkouts, but only 5% for successful read-only catalog queries.

7. Data Flow Diagram
   The following diagram illustrates the end-to-end data lifecycle from a shopper adding an item to the cart, through payment, to the asynchronous indexing of the order for the vendor dashboard.

[Shopper] [Edge / Gateway] [Microservices] [Data / Async]
│ │ │ │
│ 1. Add to Cart (GraphQL) │ │ │
├─────────────────────────────────► Apollo Router ───────────────────► Cart Service (Go) ───────────────► Redis (Session state updated)
│ │ │ │
│ 2. Checkout Mutation │ │ │
├─────────────────────────────────► Apollo Router ───────────────────► Cart Service (Go) ───────────────► Redis (Acquire Inventory Lock)
│ │ │ │ │
│ │ │ ├─► Stripe API (Create Intent)
│ 3. Submit Payment (Stripe UI) │ │ │ │
├─────────────────────────────────┼──────────────────────────────────┼────────┴─────────────────────────► Stripe (Processes Card)
│ │ │ │
│ │ 4. Webhook (payment_intent.succ) │ │
│ ◄──────────────────────────────────┼──────────────────────────────────┤
│ │ │ │
│ │ Routes to Webhook Worker │ │
│ ├──────────────────────────────────► Webhook Worker ──────────────────► Kafka (Pub: PaymentSucceeded)
│ │ │ │
│ │ │ │ 5. Consume Event
│ │ ◄──────────────────────────────────┤
│ │ │ OMS Service (NestJS) │
│ │ ├──────────────────────────────────► PostgreSQL (Create Order & SubOrders)
│ │ ├──────────────────────────────────► Kafka (Pub: OrderCreated)
│ │ │ │
│ │ │ │ 6. Consume Event
│ │ ◄──────────────────────────────────┤
│ │ │ Search Sync Worker (Go) │
│ │ ├──────────────────────────────────► Algolia (Update Vendor Dashboard Index)
│ │ │ │
Data Lifecycle Summary:
Transient State: Cart data lives in Redis. It is fast, ephemeral, and easily discarded if the session expires.
Transactional State: Upon payment, the state moves to PostgreSQL via the OMS service. This is the source of truth for financial records and is strictly ACID compliant.
Analytical / Search State: Data is fanned out via Kafka to Algolia (for search) and to a data warehouse (out of scope for v1.0, but architecture supports it) for reporting. This ensures the transactional DB is never bogged down by heavy analytical read queries.
