# Stage 1: Build
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Install git, CA certificates, and tzdata
RUN apk add --no-cache git ca-certificates tzdata

# Copy go mod files for dependency caching
# Using a wildcard for go.sum in case it doesn't exist yet
COPY go.mod go.sum* ./

# Download dependencies
RUN go mod download || true

# Copy the rest of the source code
COPY . .

# Build the Go binary statically
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-w -s" -o /app/bin/catalog-pim .

# Stage 2: Runtime
FROM alpine:3.19 AS runner

WORKDIR /app

# Copy CA certificates and timezone data from the builder stage
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

# Copy the compiled binary
COPY --from=builder /app/bin/catalog-pim /app/catalog-pim

# Create and use a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Expose the service port
EXPOSE 8080

# Run the binary
ENTRYPOINT ["/app/catalog-pim"]
