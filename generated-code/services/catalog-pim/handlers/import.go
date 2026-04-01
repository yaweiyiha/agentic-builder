package handlers

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"
	"gorm.io/gorm"
)

// Product represents the catalog item model
type Product struct {
	ID          string    `gorm:"primaryKey;type:uuid"`
	VendorID    string    `gorm:"index;not null"`
	SKU         string    `gorm:"uniqueIndex;not null"`
	Name        string    `gorm:"not null"`
	Description string    `gorm:"type:text"`
	Price       float64   `gorm:"type:decimal(10,2);not null"`
	Stock       int       `gorm:"not null"`
	CreatedAt   time.Time `gorm:"autoCreateTime"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime"`
}

// ProductCreatedEvent represents the payload sent to Kafka
type ProductCreatedEvent struct {
	EventID   string    `json:"event_id"`
	EventType string    `json:"event_type"`
	Timestamp time.Time `json:"timestamp"`
	Data      Product   `json:"data"`
}

// BulkImportRequest represents the expected JSON payload
type BulkImportRequest struct {
	VendorID string `json:"vendor_id"`
	Bucket   string `json:"bucket"`
	Key      string `json:"key"`
}

// BulkImportResponse represents the API response
type BulkImportResponse struct {
	Message        string `json:"message"`
	ProductsParsed int    `json:"products_parsed"`
	ProductsSaved  int    `json:"products_saved"`
}

// ImportHandler handles bulk import operations
type ImportHandler struct {
	DB          *gorm.DB
	S3Client    *s3.Client
	KafkaWriter *kafka.Writer
}

// NewImportHandler creates a new ImportHandler
func NewImportHandler(db *gorm.DB, s3Client *s3.Client, kafkaWriter *kafka.Writer) *ImportHandler {
	return &ImportHandler{
		DB:          db,
		S3Client:    s3Client,
		KafkaWriter: kafkaWriter,
	}
}

// HandleBulkImport downloads a CSV from S3, parses it, inserts into DB, and publishes to Kafka
func (h *ImportHandler) HandleBulkImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req BulkImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request payload", http.StatusBadRequest)
		return
	}

	if req.VendorID == "" || req.Bucket == "" || req.Key == "" {
		http.Error(w, "vendor_id, bucket, and key are required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	// 1. Download CSV from S3
	s3Obj, err := h.S3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(req.Bucket),
		Key:    aws.String(req.Key),
	})
	if err != nil {
		log.Printf("Failed to download from S3: %v", err)
		http.Error(w, "Failed to retrieve file from S3", http.StatusInternalServerError)
		return
	}
	defer s3Obj.Body.Close()

	// 2. Parse CSV
	products, err := h.parseCSV(s3Obj.Body, req.VendorID)
	if err != nil {
		log.Printf("Failed to parse CSV: %v", err)
		http.Error(w, fmt.Sprintf("Failed to parse CSV: %v", err), http.StatusBadRequest)
		return
	}

	if len(products) == 0 {
		http.Error(w, "CSV is empty or contains only headers", http.StatusBadRequest)
		return
	}

	// 3. Batch Insert via GORM
	// Using a transaction to ensure data integrity
	err = h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.CreateInBatches(&products, 100).Error; err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		log.Printf("Failed to insert products: %v", err)
		http.Error(w, "Database insertion failed", http.StatusInternalServerError)
		return
	}

	// 4. Publish ProductCreated events to Kafka
	go h.publishEvents(context.Background(), products)

	// 5. Return Success Response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(BulkImportResponse{
		Message:        "Bulk import processed successfully",
		ProductsParsed: len(products),
		ProductsSaved:  len(products),
	})
}

// parseCSV reads the CSV and maps it to Product models
// Expected CSV format: SKU, Name, Description, Price, Stock
func (h *ImportHandler) parseCSV(reader io.Reader, vendorID string) ([]Product, error) {
	csvReader := csv.NewReader(reader)
	
	// Read header
	_, err := csvReader.Read()
	if err != nil {
		if err == io.EOF {
			return nil, fmt.Errorf("empty CSV file")
		}
		return nil, err
	}

	var products []Product
	for {
		record, err := csvReader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		if len(record) < 5 {
			continue // Skip malformed rows
		}

		price, _ := strconv.ParseFloat(record[3], 64)
		stock, _ := strconv.Atoi(record[4])

		product := Product{
			ID:          uuid.New().String(),
			VendorID:    vendorID,
			SKU:         record[0],
			Name:        record[1],
			Description: record[2],
			Price:       price,
			Stock:       stock,
		}
		products = append(products, product)
	}

	return products, nil
}

// publishEvents sends a batch of product creation events to Kafka
func (h *ImportHandler) publishEvents(ctx context.Context, products []Product) {
	var messages []kafka.Message

	for _, p := range products {
		event := ProductCreatedEvent{
			EventID:   uuid.New().String(),
			EventType: "ProductCreated",
			Timestamp: time.Now().UTC(),
			Data:      p,
		}

		eventBytes, err := json.Marshal(event)
		if err != nil {
			log.Printf("Failed to marshal event for product %s: %v", p.ID, err)
			continue
		}

		messages = append(messages, kafka.Message{
			Key:   []byte(p.VendorID), // Partition by VendorID
			Value: eventBytes,
		})

		// Flush in batches of 100 to avoid huge memory spikes
		if len(messages) >= 100 {
			if err := h.KafkaWriter.WriteMessages(ctx, messages...); err != nil {
				log.Printf("Failed to publish Kafka messages: %v", err)
			}
			messages = nil // Reset slice
		}
	}

	// Flush remaining messages
	if len(messages) > 0 {
		if err := h.KafkaWriter.WriteMessages(ctx, messages...); err != nil {
			log.Printf("Failed to publish Kafka messages: %v", err)
		}
	}
}
