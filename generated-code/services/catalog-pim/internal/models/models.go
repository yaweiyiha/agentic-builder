package models

import (
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// Category represents a product category in the catalog
type Category struct {
	gorm.Model
	Name        string    `gorm:"not null"`
	Slug        string    `gorm:"uniqueIndex;not null"`
	Description string
	Products    []Product `gorm:"many2many:product_categories;"`
}

// Product represents the core PIM product model
type Product struct {
	gorm.Model
	VendorID    string         `gorm:"index;not null"`
	Name        string         `gorm:"not null"`
	Slug        string         `gorm:"uniqueIndex;not null"`
	Description string
	Status      string         `gorm:"default:'DRAFT';index"` // DRAFT, PUBLISHED, SCHEDULED
	Attributes  datatypes.JSON `gorm:"type:jsonb"`            // Flexible PIM custom attributes
	Categories  []Category     `gorm:"many2many:product_categories;"`
	Variants    []Variant      `gorm:"foreignKey:ProductID"`
}

// Variant represents a specific purchasable SKU of a product
type Variant struct {
	gorm.Model
	ProductID   uint           `gorm:"index;not null"`
	SKU         string         `gorm:"uniqueIndex;not null"`
	Price       float64        `gorm:"not null"`
	Inventory   int            `gorm:"not null;default:0"`
	Attributes  datatypes.JSON `gorm:"type:jsonb"` // Variant-specific attributes (e.g., size, color)
	B2BPricing  []PricingTier  `gorm:"foreignKey:VariantID"`
}

// PricingTier supports B2B volume-tiered discounts and customer group pricing
type PricingTier struct {
	gorm.Model
	VariantID     uint    `gorm:"index;not null"`
	CustomerGroup string  `gorm:"index;not null"` // e.g., "WHOLESALE_A", "RETAIL"
	MinQuantity   int     `gorm:"not null;default:1"`
	Price         float64 `gorm:"not null"`
}
