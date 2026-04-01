package main

import (
	"log"
	"os"

	"github.com/aerocommerce/catalog-pim/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	// Default to local docker-compose credentials if not provided
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "host=localhost user=aero_user password=aero_password dbname=catalog_db port=5432 sslmode=disable"
	}

	log.Printf("Connecting to Catalog Database...")
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	log.Println("Running GORM AutoMigrate for Catalog & PIM schemas...")
	
	// Execute auto-migrations for all catalog models
	err = db.AutoMigrate(
		&models.Category{},
		&models.Product{},
		&models.Variant{},
		&models.PricingTier{},
	)

	if err != nil {
		log.Fatalf("AutoMigrate failed: %v", err)
	}

	log.Println("Catalog database migration completed successfully.")
}
