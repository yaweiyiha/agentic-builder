Implementation Guide: AeroCommerce
This guide is structured as ordered phases with file paths, commands, and acceptance criteria designed for direct execution by an engineering team or AI coding agent. It strictly follows the AeroCommerce PRD, TRD, and System Design documents.

Phase 0: Project Scaffolding & Local Infrastructure (Day 1–3)
This phase establishes the monorepo structure, initializes the microservices, frontends, and sets up the local development environment using Docker Compose to simulate AWS managed services (PostgreSQL, Redis, Kafka).

0.1 Directory Tree
aerocommerce/
├── apps/
│ ├── admin-dashboard/ # React 18 + Vite (FR-MVM01)
│ ├── vendor-dashboard/ # React 18 + Vite (FR-MVM01)
│ └── storefront/ # Next.js 14 App Router (FR-API01)
├── services/
│ ├── catalog-pim/ # Go 1.21 (FR-PIM01)
│ ├── cart-checkout/ # Go 1.21 (FR-API02, US-07)
│ ├── oms/ # NestJS (FR-OMS01)
│ └── vendor-finance/ # NestJS (FR-MVM02, US-10)
├── workers/
│ ├── search-sync/ # Go 1.21 (FR-SRC01)
│ └── webhook-dispatch/ # Go 1.21 (FR-API04)
├── gateway/ # Apollo Router (Rust)
├── packages/ # Shared TS types, UI components
└── docker-compose.yml # Local infra (Postgres, Redis, Kafka)
0.2 Scaffold Commands
Execute the following commands from the root directory (aerocommerce/) to initialize the workspaces.

Step Command Target Directory Description
1 npm init -y && npm pkg set workspaces.0="apps/_" workspaces.1="services/_" workspaces.2="packages/\*" / Initialize NPM workspaces for TS/JS projects.
2 npx create-next-app@14 storefront --ts --tailwind --eslint --app --src-dir --use-npm /apps Scaffold Next.js Storefront (US-05).
3 npm create vite@latest admin-dashboard -- --template react-ts /apps Scaffold Admin Dashboard.
4 npm create vite@latest vendor-dashboard -- --template react-ts /apps Scaffold Vendor Dashboard.
5 npx @nestjs/cli new oms --strict --package-manager npm /services Scaffold OMS Service.
6 npx @nestjs/cli new vendor-finance --strict --package-manager npm /services Scaffold Vendor Finance Service.
7 go mod init github.com/aerocommerce/catalog-pim /services/catalog-pim Initialize Go Catalog Service.
8 go mod init github.com/aerocommerce/cart-checkout /services/cart-checkout Initialize Go Cart Service.
9 curl -sSL https://router.apollo.dev/download/nix/latest | sh /gateway Download Apollo Router binary.
0.3 Local Infrastructure Setup
Create docker-compose.yml in the root to spin up the Data Plane.

File: /docker-compose.yml

version: '3.8'
services:
postgres-catalog:
image: postgres:15-alpine
environment:
POSTGRES_USER: aero_user
POSTGRES_PASSWORD: aero_password
POSTGRES_DB: catalog_db
ports: - "5432:5432"
postgres-oms:
image: postgres:15-alpine
environment:
POSTGRES_USER: aero_user
POSTGRES_PASSWORD: aero_password
POSTGRES_DB: oms_db
ports: - "5433:5432"
redis:
image: redis:7-alpine
ports: - "6379:6379"
zookeeper:
image: confluentinc/cp-zookeeper:7.3.2
environment:
ZOOKEEPER_CLIENT_PORT: 2181
kafka:
image: confluentinc/cp-kafka:7.3.2
depends_on: - zookeeper
ports: - "9092:9092"
environment:
KAFKA_BROKER_ID: 1
KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
Acceptance Criteria
Monorepo structure is created with all specified directories.
Next.js, Vite, NestJS, and Go projects are successfully initialized without errors.
docker-compose up -d successfully starts PostgreSQL (x2), Redis, Zookeeper, and Kafka.
Apollo Router binary is executable in the /gateway directory.
Phase 1: Data Layer & Core Domain Models (Day 4–7)
Establish the database schemas for the decentralized microservices. We use GORM for Go services and Prisma for NestJS services.

1.1 Catalog & PIM Database (Go / GORM)
File: /services/catalog-pim/models/product.go

package models

import (
"time"
"github.com/google/uuid"
"gorm.io/datatypes"
"gorm.io/gorm"
)

// Product represents the core catalog item (FR-PIM01)
type Product struct {
ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
VendorID uuid.UUID `gorm:"type:uuid;index"`
Name string `gorm:"type:varchar(255);not null"`
Description string `gorm:"type:text"`
BasePrice float64 `gorm:"type:decimal(10,2);not null"`
Attributes datatypes.JSON `gorm:"type:jsonb"` // Unlimited custom attributes
Status string `gorm:"type:varchar(50);default:'Draft'"` // FR-PIM05
CreatedAt time.Time
UpdatedAt time.Time
DeletedAt gorm.DeletedAt `gorm:"index"`
Variants []Variant `gorm:"foreignKey:ProductID"`
}

// Variant represents a specific SKU (FR-PIM02)
type Variant struct {
ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
ProductID uuid.UUID `gorm:"type:uuid;index"`
SKU string `gorm:"type:varchar(100);uniqueIndex;not null"`
InventoryCount int `gorm:"type:int;default:0"`
Attributes datatypes.JSON `gorm:"type:jsonb"` // e.g., {"Size": "M", "Color": "Red"}
}

// B2BPricingRule supports volume-based tiered pricing (FR-PRC03)
type B2BPricingRule struct {
ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
CustomerGroupID uuid.UUID `gorm:"type:uuid;index"`
ProductID uuid.UUID `gorm:"type:uuid;index"`
MinQuantity int `gorm:"type:int;not null"`
DiscountPercentage float64 `gorm:"type:decimal(5,2);not null"`
}
1.2 OMS Database (NestJS / Prisma)
Initialize Prisma in the OMS service:

Step Command Target Directory Description
1 npm install prisma --save-dev /services/oms Install Prisma CLI.
2 npx prisma init /services/oms Initialize Prisma schema.
File: /services/oms/prisma/schema.prisma

datasource db {
provider = "postgresql"
url = env("DATABASE_URL")
}

generator client {
provider = "prisma-client-js"
}

// Order represents the parent order (FR-OMS01)
model Order {
id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
customerId String? @db.Uuid // Nullable for guests
status OrderStatus @default(PENDING)
totalAmount Decimal @db.Decimal(10, 2)
stripePaymentId String?
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
subOrders SubOrder[]
}

// SubOrder enables mixed carts and separate vendor fulfillment (FR-MVM03)
model SubOrder {
id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
parentOrderId String @db.Uuid
vendorId String @db.Uuid
status OrderStatus @default(PENDING)
platformCommission Decimal @db.Decimal(10, 2)
vendorPayout Decimal @db.Decimal(10, 2)
trackingNumber String?
carrier String?
parentOrder Order @relation(fields: [parentOrderId], references: [id])
items OrderItem[]
}

model OrderItem {
id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
subOrderId String @db.Uuid
productId String @db.Uuid
variantId String @db.Uuid
sku String
quantity Int
price Decimal @db.Decimal(10, 2)
subOrder SubOrder @relation(fields: [subOrderId], references: [id])
}

enum OrderStatus {
PENDING
PAID
PROCESSING
SHIPPED
DELIVERED
CANCELED
REFUNDED
}
Acceptance Criteria
Go GORM auto-migration successfully creates products, variants, and b2_b_pricing_rules tables in catalog_db.
Prisma migration (npx prisma migrate dev) successfully creates Order, SubOrder, and OrderItem tables in oms_db.
Database schemas strictly enforce UUIDs for primary keys and foreign keys.
Phase 2: API Gateway & Authentication (Day 8–10)
Configure Apollo Router to federate the GraphQL subgraphs and validate Auth0 JWTs at the edge.

2.1 Apollo Router Configuration
Create the router configuration file to handle CORS, routing, and JWT validation.

File: /gateway/router.yaml

supergraph:
listen: 0.0.0.0:4000

cors:
origins: - https://storefront.aerocommerce.com - http://localhost:3000
allow_credentials: true

authentication:
jwt:
jwks: - url: https://YOUR_AUTH0_DOMAIN/.well-known/jwks.json
audience: "https://api.aerocommerce.com"

headers:
all:
request: - propagate:
named: "authorization" # Pass JWT to subgraphs for RBAC - propagate:
named: "x-customer-group-id" # For B2B pricing

routing:
subgraphs:
catalog:
routing_url: http://localhost:8081/query
cart:
routing_url: http://localhost:8082/query
oms:
routing_url: http://localhost:8083/graphql
2.2 Subgraph Schema Definition (Catalog Example)
File: /services/catalog-pim/graph/schema.graphqls

extend schema
@link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"])

type Product @key(fields: "id") {
id: ID!
vendorId: ID!
name: String!
description: String
basePrice: Float!
dynamicPrice: Float! # Calculated based on B2B rules
attributes: String! # JSON string
status: String!
variants: [Variant!]!
}

type Variant @key(fields: "id") {
id: ID!
productId: ID!
sku: String!
inventoryCount: Int!
attributes: String!
}

type Query {
product(id: ID!): Product
products(vendorId: ID, limit: Int, offset: Int): [Product!]!
}

type Mutation {
createProduct(input: CreateProductInput!): Product!
}

input CreateProductInput {
vendorId: ID!
name: String!
basePrice: Float!
attributes: String!
}
Acceptance Criteria
Apollo Router starts successfully on port 4000.
Router rejects requests without a valid Auth0 JWT when accessing protected mutations.
Router successfully composes the supergraph schema from the underlying subgraphs (Catalog, Cart, OMS).
Phase 3: Catalog & PIM Service (Day 11–15)
Implement the Go-based Catalog service. This service handles high-throughput reads, B2B pricing overlays, and bulk imports.

3.1 GraphQL Resolvers & B2B Pricing Logic
File: /services/catalog-pim/graph/schema.resolvers.go

package graph

import (
"context"
"encoding/json"
"github.com/aerocommerce/catalog-pim/models"
)

// Product resolver fetches dynamic pricing (FR-PRC02, FR-PRC03)
func (r *queryResolver) Product(ctx context.Context, id string) (*models.Product, error) {
var product models.Product
if err := r.DB.Preload("Variants").First(&product, "id = ?", id).Error; err != nil {
return nil, err
}

    // Check for B2B Customer Group ID in context (injected by Apollo Router)
    customerGroupID := ctx.Value("x-customer-group-id")
    if customerGroupID != nil {
    	var rule models.B2BPricingRule
    	// Find applicable discount rule
    	err := r.DB.Where("product_id = ? AND customer_group_id = ?", id, customerGroupID).First(&rule).Error
    	if err == nil {
    		// Apply discount
    		discountMultiplier := (100.0 - rule.DiscountPercentage) / 100.0
    		product.BasePrice = product.BasePrice * discountMultiplier
    	}
    }

    return &product, nil

}
3.2 Bulk Import Logic (FR-PIM03)
Implement a REST endpoint for handling S3 presigned URLs for bulk CSV/JSON imports.

File: /services/catalog-pim/handlers/import.go

package handlers

import (
"encoding/csv"
"net/http"
"github.com/aws/aws-sdk-go/service/s3"
// ... imports
)

func BulkImportHandler(w http.ResponseWriter, r \*http.Request) {
// 1. Parse S3 Object Key from request body
// 2. Download file from S3
// 3. Parse CSV
// 4. Batch insert into PostgreSQL using GORM
// 5. Publish `ProductCreated` events to Kafka
// Pseudo-code for Kafka publishing:
// for \_, product := range batch {
// msg := formatKafkaMessage(product)
// kafkaProducer.Produce(&kafka.Message{
// TopicPartition: kafka.TopicPartition{Topic: &"catalog.events", Partition: kafka.PartitionAny},
// Value: msg,
// }, nil)
// }
w.WriteHeader(http.StatusAccepted)
w.Write([]byte(`{"status": "processing"}`))
}
Acceptance Criteria
query Product($id) returns the product and its variants in < 50ms (local DB).
Passing x-customer-group-id header dynamically alters the returned basePrice based on B2B rules.
POST /api/v1/admin/catalog/bulk-import accepts an S3 key, processes the file, and writes to the DB.
Bulk import successfully publishes ProductCreated events to the local Kafka broker.
Phase 4: Cart & Checkout Service (Day 16–20)
Implement the Go-based Cart service. This service uses Redis for ephemeral cart state and Redlock for strict inventory consistency during checkout.

4.1 Redis Cart State & Redlock (US-07)
Step Command Target Directory Description
1 go get github.com/redis/go-redis/v9 /services/cart-checkout Install Redis client.
2 go get github.com/go-redsync/redsync/v4 /services/cart-checkout Install Redlock implementation.
File: /services/cart-checkout/checkout/manager.go

package checkout

import (
"context"
"fmt"
"time"
"github.com/go-redsync/redsync/v4"
"github.com/redis/go-redis/v9"
)

type CheckoutManager struct {
RedisClient *redis.Client
Redsync *redsync.Redsync
}

// LockInventory prevents overselling during checkout (US-07)
func (cm *CheckoutManager) LockInventory(ctx context.Context, cartID string, items []CartItem) error {
for \_, item := range items {
mutexName := fmt.Sprintf("inventory_lock:%s", item.VariantID)
mutex := cm.Redsync.NewMutex(mutexName, redsync.WithExpiry(15*time.Minute))
if err := mutex.Lock(); err != nil {
return fmt.Errorf("INVENTORY_UNAVAILABLE: %s", item.VariantID)
}
// Note: In a full implementation, we would also decrement the actual
// inventory count in Redis here, and rollback if Stripe fails.
}
return nil
}
4.2 Stripe Payment Intent Creation
File: /services/cart-checkout/stripe/client.go

package stripeclient

import (
"github.com/stripe/stripe-go/v75"
"github.com/stripe/stripe-go/v75/paymentintent"
)

// CreateIntent creates a Stripe PaymentIntent with multi-vendor routing metadata
func CreateIntent(amount int64, currency string, cartID string) (\*stripe.PaymentIntent, error) {
stripe.Key = "sk*test*..."

    params := &stripe.PaymentIntentParams{
    	Amount:   stripe.Int64(amount),
    	Currency: stripe.String(currency),
    	Metadata: map[string]string{
    		"cart_id": cartID,
    	},
    	// For Stripe Connect, we use transfer_group to link sub-orders later
    	TransferGroup: stripe.String(cartID),
    }

    return paymentintent.New(params)

}
Acceptance Criteria
mutation AddToCart stores cart data in Redis with a 7-day TTL.
mutation Checkout successfully acquires a Redis lock for the requested SKUs.
If a lock is already held by another session, Checkout returns an INVENTORY_UNAVAILABLE error.
Checkout mutation successfully calls Stripe and returns a client_secret to the frontend.
Phase 5: OMS & Vendor Service (Day 21–25)
Implement the NestJS services to handle order state machines, vendor commissions, and Kafka event consumption.

5.1 Kafka Consumer for Order Creation (FR-MVM03)
Step Command Target Directory Description
1 npm install kafkajs @nestjs/microservices /services/oms Install Kafka dependencies.
File: /services/oms/src/orders/orders.controller.ts

import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { OrdersService } from './orders.service';

@Controller()
export class OrdersController {
constructor(private readonly ordersService: OrdersService) {}

// Consumes event published by the Webhook Dispatch Worker after Stripe success
@EventPattern('payment.succeeded')
async handlePaymentSucceeded(@Payload() message: any) {
const { cartId, stripePaymentId, amount, items } = message;

    // 1. Create Parent Order
    // 2. Split into SubOrders based on vendorId (FR-MVM03)
    await this.ordersService.createSplitOrder(cartId, stripePaymentId, items);

}
}
5.2 Order Splitting & Commission Logic
File: /services/oms/src/orders/orders.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrdersService {
constructor(private prisma: PrismaService) {}

async createSplitOrder(cartId: string, stripePaymentId: string, items: any[]) {
// Group items by Vendor
const itemsByVendor = items.reduce((acc, item) => {
acc[item.vendorId] = acc[item.vendorId] || [];
acc[item.vendorId].push(item);
return acc;
}, {});

    const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Transaction to ensure atomic order creation
    await this.prisma.$transaction(async (tx) => {
      const parentOrder = await tx.order.create({
        data: {
          id: cartId, // Use cartId as Order ID for idempotency
          totalAmount,
          stripePaymentId,
          status: 'PAID',
        }
      });

      for (const [vendorId, vendorItems] of Object.entries(itemsByVendor)) {
        const subTotal = (vendorItems as any[]).reduce((sum, item) => sum + (item.price * item.quantity), 0);

        // Calculate 10% platform commission (FR-MVM02)
        const platformCommission = subTotal * 0.10;
        const vendorPayout = subTotal - platformCommission;

        await tx.subOrder.create({
          data: {
            parentOrderId: parentOrder.id,
            vendorId,
            platformCommission,
            vendorPayout,
            status: 'PAID',
            items: {
              create: (vendorItems as any[]).map(item => ({
                productId: item.productId,
                variantId: item.variantId,
                sku: item.sku,
                quantity: item.quantity,
                price: item.price
              }))
            }
          }
        });
      }
    });

}
}
Acceptance Criteria
NestJS service successfully connects to the local Kafka broker.
Publishing a mock payment.succeeded event to Kafka triggers the creation of 1 Order and N SubOrder records in PostgreSQL.
Platform commission and vendor payout are calculated correctly and stored in the database.
The transaction rolls back entirely if any sub-order fails to insert.
Phase 6: Search & Event Workers (Day 26–28)
Implement the standalone Go workers for syncing catalog data to Algolia and dispatching webhooks.

6.1 Algolia Search Sync Worker (FR-SRC01)
File: /workers/search-sync/main.go

package main

import (
"context"
"encoding/json"
"log"
"github.com/algolia/algoliasearch-client-go/v3/algolia/search"
"github.com/segmentio/kafka-go"
)

func main() {
// Initialize Algolia Client
client := search.NewClient("YOUR_APP_ID", "YOUR_API_KEY")
index := client.InitIndex("products_index")

    // Initialize Kafka Reader
    r := kafka.NewReader(kafka.ReaderConfig{
    	Brokers:   []string{"localhost:9092"},
    	Topic:     "catalog.events",
    	GroupID:   "search-sync-group",
    })

    for {
    	m, err := r.ReadMessage(context.Background())
    	if err != nil {
    		log.Printf("Error reading message: %v", err)
    		continue
    	}

    	var event struct {
    		Type    string `json:"type"`
    		Product map[string]interface{} `json:"product"`
    	}
    	json.Unmarshal(m.Value, &event)

    	if event.Type == "ProductCreated" || event.Type == "ProductUpdated" {
    		// Map to Algolia object (requires ObjectID)
    		event.Product["objectID"] = event.Product["id"]

    		_, err := index.SaveObject(event.Product)
    		if err != nil {
    			log.Printf("Algolia sync failed: %v", err)
    		} else {
    			log.Printf("Synced product %s to Algolia", event.Product["id"])
    		}
    	}
    }

}
6.2 Webhook Dispatch Worker (FR-API04)
Listens to Stripe webhooks via a lightweight HTTP server.
Validates Stripe cryptographic signatures.
Publishes payment.succeeded or payment.failed to Kafka.
Acceptance Criteria
Search Sync worker successfully consumes catalog.events from Kafka.
Products are visible in the Algolia dashboard within 5 seconds of the Kafka event being published.
Webhook Dispatch worker successfully validates a Stripe test webhook signature and publishes to Kafka.
Phase 7: Frontend - Dashboards (Day 29–34)
Build the React 18 / Vite Single Page Applications for the Admin and Vendor portals.

7.1 Dashboard Setup & TanStack Query
Step Command Target Directory Description
1 npm install @tanstack/react-query axios zustand react-router-dom lucide-react /apps/admin-dashboard Install core dependencies.
2 npm install -D tailwindcss postcss autoprefixer && npx tailwindcss init -p /apps/admin-dashboard Setup Tailwind CSS.
File: /apps/admin-dashboard/src/hooks/useProducts.ts

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

const fetchProducts = async () => {
// Calls the Apollo Gateway REST/GraphQL endpoint
const { data } = await axios.post('http://localhost:4000/', {
query: `       query {
        products(limit: 50) {
          id
          name
          basePrice
          status
        }
      }
    `
}, {
headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
});
return data.data.products;
};

export const useProducts = () => {
return useQuery({
queryKey: ['products'],
queryFn: fetchProducts,
});
};
7.2 Vendor Order Management UI (FR-MVM01)
Create a data table displaying SubOrders specific to the logged-in Vendor.
Implement a form to submit trackingNumber and carrier (PUT /api/v1/vendor/orders/:id/tracking).
Acceptance Criteria
Admin Dashboard successfully fetches and displays products using TanStack Query.
Vendor Dashboard restricts order visibility to only the logged-in vendor's SubOrders (validated via JWT).
UI components are styled with Tailwind CSS and meet WCAG 2.1 AA contrast requirements.
Phase 8: Frontend - Storefront (Day 35–40)
Build the Next.js 14 App Router storefront, focusing on Server Components for SEO/Performance and Client Components for interactivity.

8.1 Product Detail Page (RSC + ISR)
File: /apps/storefront/src/app/products/[id]/page.tsx

import { notFound } from 'next/navigation';
import AddToCartButton from '@/components/AddToCartButton'; // Client Component

// ISR: Revalidate this page every 60 seconds
export const revalidate = 60;

async function getProduct(id: string) {
const res = await fetch('http://localhost:4000/', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
query: `         query GetProduct($id: ID!) {
          product(id: $id) {
            id
            name
            description
            basePrice
            variants { id sku attributes }
          }
        }
      `,
variables: { id }
}),
// Next.js fetch cache configuration
next: { tags: ['catalog'] }
});
const json = await res.json();
return json.data.product;
}

export default async function ProductPage({ params }: { params: { id: string } }) {
const product = await getProduct(params.id);

if (!product) return notFound();

return (
<div className="container mx-auto p-8">
<h1 className="text-4xl font-bold">{product.name}</h1>
<p className="text-gray-600 mt-4">{product.description}</p>
<p className="text-2xl font-semibold mt-4">${product.basePrice}</p>

      {/* Client Component for interactive state */}
      <AddToCartButton product={product} />
    </div>

);
}
8.2 Checkout Flow & Stripe Elements
Integrate @stripe/react-stripe-js and @stripe/stripe-js.
Fetch client_secret from the Cart Service Checkout mutation.
Render the PaymentElement for secure, PCI-compliant card entry.
Acceptance Criteria
Product Detail Pages (PDP) render HTML from the server (viewable via "View Page Source").
Next.js ISR successfully caches the page and revalidates after 60 seconds.
Stripe Elements load successfully in the checkout flow.
Submitting the checkout form triggers the full end-to-end flow (Inventory Lock -> Stripe Intent -> Webhook -> Order Split).
Phase 9: Testing & Hardening (Day 41–45)
Ensure the system meets the non-functional requirements, specifically the 10,000 RPS scalability target and <100ms latency target.

9.1 Load Testing with k6
Step Command Target Directory Description
1 brew install k6 / Install k6 load testing tool (macOS).
File: /tests/load/catalog_read.js

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
stages: [
{ duration: '1m', target: 5000 }, // Ramp up to 5k users
{ duration: '3m', target: 10000 }, // Peak at 10k users
{ duration: '1m', target: 0 }, // Ramp down
],
thresholds: {
http_req_duration: ['p(95)<100'], // 95% of requests must complete below 100ms
},
};

export default function () {
const payload = JSON.stringify({
query: `query { products(limit: 10) { id name basePrice } }`,
});

const params = {
headers: { 'Content-Type': 'application/json' },
};

// Hitting the Apollo Router Gateway
const res = http.post('http://localhost:4000/', payload, params);

check(res, {
'status is 200': (r) => r.status === 200,
'no graphql errors': (r) => !r.body.includes('errors'),
});

sleep(1);
}
Acceptance Criteria
Unit tests pass for Go services (go test ./...) and NestJS services (npm run test).
k6 load test achieves 10,000 RPS with a P95 latency of < 100ms for edge-cached catalog queries.
Datadog APM traces confirm no N+1 query issues in the GraphQL resolvers.
Phase 10: Infrastructure & Launch (Day 46–50)
Containerize the applications and set up the GitOps CI/CD pipeline for deployment to AWS EKS.

10.1 Dockerfiles
File: /services/catalog-pim/Dockerfile

FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o catalog-service ./cmd/server

FROM alpine:latest
WORKDIR /root/
COPY --from=builder /app/catalog-service .
EXPOSE 8081
CMD ["./catalog-service"]
10.2 CI/CD Pipeline (GitHub Actions)
File: /.github/workflows/deploy.yml

name: Build and Push to ECR

on:
push:
branches: [ "main" ]

jobs:
build-catalog:
runs-on: ubuntu-latest
steps: - uses: actions/checkout@v3

    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v2
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: us-east-1

    - name: Login to Amazon ECR
      id: login-ecr
      uses: aws-actions/amazon-ecr-login@v1

    - name: Build, tag, and push image to Amazon ECR
      env:
        ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
        ECR_REPOSITORY: aerocommerce/catalog
        IMAGE_TAG: ${{ github.sha }}
      run: |
        docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG ./services/catalog-pim
        docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG

    # Note: ArgoCD will detect the new image tag in the manifests repo and trigger the K8s rollout.

Launch Checklist
All Docker images build successfully and are pushed to AWS ECR.
Kubernetes manifests (Deployments, Services, HPA) are applied via ArgoCD.
AWS CloudFront distribution is configured to point to the Next.js Storefront and Apollo Router edge.
Auth0 production tenant is configured with correct callback URLs.
Stripe production webhooks are registered and pointing to the live API Gateway.
Datadog monitors and PagerDuty alerts are active.
Appendix A: Environment Variables Reference
Variable Service Description
DATABASE_URL Catalog, OMS PostgreSQL connection string (Aurora).
REDIS_URL Cart ElastiCache connection string.
KAFKA_BROKERS OMS, Workers Comma-separated list of MSK brokers.
STRIPE_SECRET_KEY Cart, OMS Stripe API key for processing payments.
STRIPE_WEBHOOK_SECRET Webhook Worker Secret to validate incoming Stripe events.
ALGOLIA_APP_ID Search Worker Algolia application identifier.
ALGOLIA_API_KEY Search Worker Algolia admin API key for indexing.
AUTH0_DOMAIN Gateway, Frontends Auth0 tenant domain for JWT validation.
Appendix B: Key Dependencies
Package / Tool Version Used In Purpose
next 14.x Storefront React framework, SSR, SSG, App Router.
vite 5.x Dashboards Fast build tool for React SPAs.
@nestjs/core 10.x OMS, Vendor Node.js framework for complex business logic.
gorm.io/gorm 1.25.x Catalog, Cart Go ORM for PostgreSQL interactions.
apollo-router 1.30.x Gateway Rust-based GraphQL federation gateway.
kafkajs 2.2.x OMS Node.js Kafka client.
github.com/segmentio/kafka-go 0.4.x Go Workers Go Kafka client.
@stripe/stripe-js 2.x Storefront Frontend PCI-compliant payment elements.
