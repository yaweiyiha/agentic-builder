package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// Product represents the root item in the catalog (FR-PIM01).
type Product struct {
	ID          uuid.UUID      `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	VendorID    uuid.UUID      `gorm:"type:uuid;not null;index"` // Links to Vendor in OMS/Vendor service
	Name        string         `gorm:"type:varchar(255);not null"`
	Slug        string         `gorm:"type:varchar(255);uniqueIndex;not null"`
	Description string         `gorm:"type:text"`
	Status      string         `gorm:"type:varchar(50);default:'draft';index"` // draft, published, scheduled
	Attributes  datatypes.JSON `gorm:"type:jsonb"`                             // Unlimited custom attributes (FR-PIM01)
	Variants    []Variant      `gorm:"foreignKey:ProductID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
	DeletedAt   gorm.DeletedAt `gorm:"index"`
}

// Variant represents a specific purchasable version of a Product (e.g., Size/Color) (FR-PIM02).
type Variant struct {
	ID                uuid.UUID        `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	ProductID         uuid.UUID        `gorm:"type:uuid;not null;index"`
	SKU               string           `gorm:"type:varchar(100);uniqueIndex;not null"`
	BasePrice         int64            `gorm:"not null"` // Stored in cents to avoid floating point inaccuracies
	InventoryQuantity int              `gorm:"not null;default:0"`
	Attributes        datatypes.JSON   `gorm:"type:jsonb"` // Variant-specific attributes (e.g., {"size": "M", "color": "red"})
	B2BPricingRules   []B2BPricingRule `gorm:"foreignKey:VariantID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	CreatedAt         time.Time
	UpdatedAt         time.Time
	DeletedAt         gorm.DeletedAt   `gorm:"index"`
}

// B2BPricingRule defines volume-tiered discounts and account-specific pricing (FR-PRC03).
type B2BPricingRule struct {
	ID              uuid.UUID      `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	VariantID       uuid.UUID      `gorm:"type:uuid;not null;index"`
	CustomerGroupID *uuid.UUID     `gorm:"type:uuid;index"`    // Nullable: if null, applies to all B2B. If set, applies to specific group/contract.
	MinQuantity     int            `gorm:"not null;default:1"` // Minimum quantity required to trigger this pricing tier
	Price           int64          `gorm:"not null"`           // Discounted price in cents
	CreatedAt       time.Time
	UpdatedAt       time.Time
	DeletedAt       gorm.DeletedAt `gorm:"index"`
}
