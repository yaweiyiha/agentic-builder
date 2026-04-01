# Stage 1: Downloader
FROM debian:bookworm-slim AS downloader

WORKDIR /app

# Install curl and CA certificates required for downloading
RUN apt-get update && apt-get install -y curl ca-certificates

# Download the latest Apollo Router binary
RUN curl -sSL https://router.apollo.dev/download/nix/latest | sh

# Stage 2: Runtime
FROM debian:bookworm-slim AS runner

WORKDIR /app

# Install CA certificates for HTTPS requests and clean up apt cache
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy the Apollo Router binary from the downloader stage
COPY --from=downloader /app/router /usr/local/bin/router

# Create a non-root user for security
RUN useradd -m -s /bin/bash routeruser
USER routeruser

# Expose the default Apollo Router port
EXPOSE 4000

# Set the entrypoint to the router binary
ENTRYPOINT ["router"]

# Default command (expects router.yaml and supergraph.graphql to be mounted or copied in later)
CMD ["--config", "router.yaml", "--supergraph", "supergraph.graphql"]
