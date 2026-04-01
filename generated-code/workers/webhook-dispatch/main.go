package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/webhook"
)

// PaymentSucceededEvent represents the payload published to Kafka
type PaymentSucceededEvent struct {
	PaymentIntentID string            `json:"payment_intent_id"`
	Amount          int64             `json:"amount"`
	Currency        string            `json:"currency"`
	Metadata        map[string]string `json:"metadata"`
	Status          string            `json:"status"`
	Timestamp       int64             `json:"timestamp"`
}

func main() {
	// Initialize structured logger
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	// Load environment variables
	port := getEnvOrDefault("PORT", "8080")
	stripeSecret := os.Getenv("STRIPE_WEBHOOK_SECRET")
	if stripeSecret == "" {
		slog.Error("STRIPE_WEBHOOK_SECRET environment variable is required")
		os.Exit(1)
	}

	kafkaBrokers := getEnvOrDefault("KAFKA_BROKERS", "localhost:9092")
	kafkaTopic := getEnvOrDefault("KAFKA_TOPIC", "payment.events")

	// Initialize Kafka Writer
	brokers := strings.Split(kafkaBrokers, ",")
	kafkaWriter := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Topic:        kafkaTopic,
		Balancer:     &kafka.LeastBytes{},
		RequiredAcks: kafka.RequireAll,
		Async:        false,
	}
	defer func() {
		if err := kafkaWriter.Close(); err != nil {
			slog.Error("Failed to close Kafka writer", "error", err)
		}
	}()

	slog.Info("Connected to Kafka", "brokers", brokers, "topic", kafkaTopic)

	// Setup HTTP Server and Routes
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	mux.HandleFunc("/webhooks/stripe", handleStripeWebhook(stripeSecret, kafkaWriter))

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start server in a goroutine
	go func() {
		slog.Info("Starting webhook dispatch worker", "port", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP server error", "error", err)
			os.Exit(1)
		}
	}()

	// Graceful shutdown setup
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	slog.Info("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("Server forced to shutdown", "error", err)
	}

	slog.Info("Server exiting")
}

// handleStripeWebhook processes incoming Stripe webhooks, verifies signatures, and publishes to Kafka
func handleStripeWebhook(secret string, kw *kafka.Writer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Limit request body size to prevent memory exhaustion attacks (Stripe payloads are typically < 64KB)
		const MaxBodyBytes = int64(65536)
		r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)

		payload, err := io.ReadAll(r.Body)
		if err != nil {
			slog.Error("Error reading request body", "error", err)
			http.Error(w, "Bad request", http.StatusBadRequest)
			return
		}

		signatureHeader := r.Header.Get("Stripe-Signature")
		if signatureHeader == "" {
			slog.Warn("Missing Stripe-Signature header")
			http.Error(w, "Missing signature", http.StatusBadRequest)
			return
		}

		// Verify cryptographic signature
		event, err := webhook.ConstructEvent(payload, signatureHeader, secret)
		if err != nil {
			slog.Error("Error verifying webhook signature", "error", err)
			http.Error(w, "Invalid signature", http.StatusBadRequest)
			return
		}

		slog.Info("Received Stripe webhook event", "type", event.Type, "id", event.ID)

		// Process specific event types
		switch event.Type {
		case "payment_intent.succeeded":
			var pi stripe.PaymentIntent
			if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
				slog.Error("Error parsing payment intent", "error", err)
				http.Error(w, "Invalid payload", http.StatusBadRequest)
				return
			}

			if err := publishPaymentSucceeded(r.Context(), kw, &pi); err != nil {
				slog.Error("Failed to publish to Kafka", "error", err)
				// Return 500 so Stripe retries the webhook
				http.Error(w, "Internal server error", http.StatusInternalServerError)
				return
			}

		default:
			// Unhandled event types are ignored but acknowledged
			slog.Debug("Unhandled event type", "type", event.Type)
		}

		// Acknowledge receipt to Stripe
		w.WriteHeader(http.StatusOK)
	}
}

// publishPaymentSucceeded constructs the domain event and writes it to Kafka
func publishPaymentSucceeded(ctx context.Context, kw *kafka.Writer, pi *stripe.PaymentIntent) error {
	eventPayload := PaymentSucceededEvent{
		PaymentIntentID: pi.ID,
		Amount:          pi.Amount,
		Currency:        string(pi.Currency),
		Metadata:        pi.Metadata,
		Status:          string(pi.Status),
		Timestamp:       time.Now().Unix(),
	}

	eventBytes, err := json.Marshal(eventPayload)
	if err != nil {
		return err
	}

	// Use Order ID as the partition key if available to ensure ordered processing per order
	var partitionKey []byte
	if orderID, ok := pi.Metadata["order_id"]; ok {
		partitionKey = []byte(orderID)
	} else {
		partitionKey = []byte(pi.ID)
	}

	msg := kafka.Message{
		Key:   partitionKey,
		Value: eventBytes,
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte("payment.succeeded")},
			{Key: "source", Value: []byte("stripe_webhook_worker")},
		},
	}

	// Publish to Kafka
	if err := kw.WriteMessages(ctx, msg); err != nil {
		return err
	}

	slog.Info("Successfully published payment.succeeded event to Kafka", 
		"payment_intent_id", pi.ID, 
		"order_id", string(partitionKey))
		
	return nil
}

// getEnvOrDefault retrieves an environment variable or returns a fallback value
func getEnvOrDefault(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}
