package cart

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// cartTTL defines the 7-day ephemeral storage requirement for carts (FR-API02)
const cartTTL = 7 * 24 * time.Hour

// CartItem represents a single product variant in the cart
type CartItem struct {
	ProductID string `json:"productId"`
	VariantID string `json:"variantId"`
	Quantity  int    `json:"quantity"`
}

// Cart represents the aggregate cart state stored in Redis
type Cart struct {
	ID        string     `json:"id"`
	Items     []CartItem `json:"items"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

// Manager handles cart business logic and Redis state management
type Manager struct {
	redisClient *redis.Client
}

// NewManager creates a new Cart Manager instance
func NewManager(redisClient *redis.Client) *Manager {
	return &Manager{
		redisClient: redisClient,
	}
}

// AddToCart adds an item to the cart or increments its quantity if it already exists.
// It resets the 7-day TTL on the cart upon modification.
func (m *Manager) AddToCart(ctx context.Context, cartID string, item CartItem) (*Cart, error) {
	if cartID == "" {
		cartID = uuid.New().String()
	}

	key := fmt.Sprintf("cart:%s", cartID)

	// 1. Fetch existing cart state
	var c Cart
	val, err := m.redisClient.Get(ctx, key).Result()
	if err == redis.Nil {
		// Initialize new cart if it doesn't exist
		c = Cart{
			ID:    cartID,
			Items: []CartItem{},
		}
	} else if err != nil {
		return nil, fmt.Errorf("failed to retrieve cart from redis: %w", err)
	} else {
		// Unmarshal existing cart
		if err := json.Unmarshal([]byte(val), &c); err != nil {
			return nil, fmt.Errorf("failed to unmarshal cart data: %w", err)
		}
	}

	// 2. Update cart items
	itemExists := false
	for i, existingItem := range c.Items {
		if existingItem.ProductID == item.ProductID && existingItem.VariantID == item.VariantID {
			c.Items[i].Quantity += item.Quantity
			itemExists = true
			break
		}
	}

	if !itemExists {
		c.Items = append(c.Items, item)
	}

	c.UpdatedAt = time.Now()

	// 3. Serialize and save back to Redis with 7-day TTL
	data, err := json.Marshal(c)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal updated cart: %w", err)
	}

	if err := m.redisClient.Set(ctx, key, data, cartTTL).Err(); err != nil {
		return nil, fmt.Errorf("failed to save cart to redis: %w", err)
	}

	return &c, nil
}

// GetCart retrieves a cart by ID without modifying its state or TTL
func (m *Manager) GetCart(ctx context.Context, cartID string) (*Cart, error) {
	key := fmt.Sprintf("cart:%s", cartID)
	val, err := m.redisClient.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil // Cart not found
	} else if err != nil {
		return nil, fmt.Errorf("failed to retrieve cart from redis: %w", err)
	}

	var c Cart
	if err := json.Unmarshal([]byte(val), &c); err != nil {
		return nil, fmt.Errorf("failed to unmarshal cart data: %w", err)
	}

	return &c, nil
}
