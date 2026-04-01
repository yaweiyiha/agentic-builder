package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/algolia/algoliasearch-client-go/v3/algolia/search"
	"github.com/segmentio/kafka-go"
)

// CatalogEvent represents the structure of messages consumed from the catalog.events topic
type CatalogEvent struct {
	EventType string         `json:"event_type"` // e.g., "PRODUCT_CREATED", "PRODUCT_UPDATED", "PRODUCT_DELETED"
	Timestamp string         `json:"timestamp"`
	Payload   ProductPayload `json:"payload"`
}

// ProductPayload represents the product data to be indexed in Algolia
type ProductPayload struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Price       float64  `json:"price"`
	VendorID    string   `json:"vendor_id"`
	Categories  []string `json:"categories"`
	ImageURL    string   `json:"image_url"`
	InStock     bool     `json:"in_stock"`
	
	// ObjectID is required by Algolia to uniquely identify records
	ObjectID string `json:"objectID,omitempty"`
}

func main() {
	log.Println("Starting Search Sync Worker...")

	// 1. Load Environment Variables
	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:9092")
	kafkaTopic := getEnv("KAFKA_TOPIC", "catalog.events")
	kafkaGroupID := getEnv("KAFKA_GROUP_ID", "search-sync-group")
	
	algoliaAppID := getEnv("ALGOLIA_APP_ID", "")
	algoliaAPIKey := getEnv("ALGOLIA_API_KEY", "")
	algoliaIndexName := getEnv("ALGOLIA_INDEX_NAME", "products_index")

	if algoliaAppID == "" || algoliaAPIKey == "" {
		log.Fatal("ALGOLIA_APP_ID and ALGOLIA_API_KEY must be set")
	}

	// 2. Initialize Algolia Client
	algoliaClient := search.NewClient(algoliaAppID, algoliaAPIKey)
	index := algoliaClient.InitIndex(algoliaIndexName)

	// 3. Initialize Kafka Reader
	brokers := strings.Split(kafkaBrokers, ",")
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        brokers,
		GroupID:        kafkaGroupID,
		Topic:          kafkaTopic,
		MinBytes:       10e3, // 10KB
		MaxBytes:       10e6, // 10MB
		CommitInterval: time.Second,
		StartOffset:    kafka.LastOffset,
	})

	// 4. Setup Graceful Shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		log.Println("Received shutdown signal, terminating worker...")
		cancel()
	}()

	// 5. Start Processing Loop
	log.Printf("Listening to Kafka topic: %s", kafkaTopic)
	for {
		// Use FetchMessage for explicit commit control (at-least-once delivery)
		msg, err := reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				break // Context canceled, exit loop
			}
			log.Printf("Error fetching message: %v", err)
			continue
		}

		var event CatalogEvent
		if err := json.Unmarshal(msg.Value, &event); err != nil {
			log.Printf("Failed to unmarshal message at offset %d: %v", msg.Offset, err)
			// Commit to skip poison pill messages
			reader.CommitMessages(ctx, msg)
			continue
		}

		// Process the event and sync to Algolia
		if err := handleEvent(index, event); err != nil {
			log.Printf("Failed to process event %s for product %s: %v", event.EventType, event.Payload.ID, err)
			// In a production scenario, we might want to send this to a Dead Letter Queue (DLQ)
			// For now, we'll log the error and still commit to prevent blocking the partition
		}

		// Commit message after successful processing
		if err := reader.CommitMessages(ctx, msg); err != nil {
			log.Printf("Failed to commit message: %v", err)
		} else {
			log.Printf("Successfully processed and committed event: %s | Product ID: %s", event.EventType, event.Payload.ID)
		}
	}

	// Cleanup
	if err := reader.Close(); err != nil {
		log.Printf("Error closing Kafka reader: %v", err)
	}
	log.Println("Search Sync Worker shut down successfully.")
}

// handleEvent processes the catalog event and updates the Algolia index accordingly
func handleEvent(index *search.Index, event CatalogEvent) error {
	switch event.EventType {
	case "PRODUCT_CREATED", "PRODUCT_UPDATED":
		record := event.Payload
		record.ObjectID = record.ID // Map internal ID to Algolia's required ObjectID

		// SaveObject creates or replaces the object in the index
		_, err := index.SaveObject(record)
		return err

	case "PRODUCT_DELETED":
		// DeleteObject removes the object from the index using its ObjectID
		_, err := index.DeleteObject(event.Payload.ID)
		return err

	default:
		log.Printf("Ignored unknown event type: %s", event.EventType)
		return nil
	}
}

// getEnv retrieves an environment variable or returns a fallback value
func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}
