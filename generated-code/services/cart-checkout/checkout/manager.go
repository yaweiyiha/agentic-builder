package checkout

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/aerocommerce/cart-checkout/stripe"
)

// CartItem represents a single line item in the shopping cart.
type CartItem struct {
	ID        string
	ProductID string
	VendorID  string
	Quantity  int
	Price     int64 // Price in the smallest currency unit (e.g., cents)
}

// Cart represents the user's shopping cart.
type Cart struct {
	ID    string
	Items []CartItem
}

// CartRepository defines the data access methods for the Cart.
type CartRepository interface {
	GetCart(ctx context.Context, cartID string) (*Cart, error)
}

// Session represents the initialized checkout session returned to the client.
type Session struct {
	OrderID         string `json:"order_id"`
	PaymentIntentID string `json:"payment_intent_id"`
	ClientSecret    string `json:"client_secret"`
	Amount          int64  `json:"amount"`
	Currency        string `json:"currency"`
}

// Manager orchestrates the checkout process.
type Manager struct {
	cartRepo     CartRepository
	stripeClient stripe.Client
}

// NewManager creates a new checkout manager instance.
func NewManager(cartRepo CartRepository, stripeClient stripe.Client) *Manager {
	return &Manager{
		cartRepo:     cartRepo,
		stripeClient: stripeClient,
	}
}

// InitiateCheckout calculates the cart total, extracts vendor routing information,
// and creates a Stripe PaymentIntent to start the payment flow.
func (m *Manager) InitiateCheckout(ctx context.Context, cartID string, customerID string) (*Session, error) {
	// 1. Retrieve the cart
	cart, err := m.cartRepo.GetCart(ctx, cartID)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve cart %s: %w", cartID, err)
	}

	if len(cart.Items) == 0 {
		return nil, fmt.Errorf("cannot initiate checkout: cart %s is empty", cartID)
	}

	// 2. Calculate total amount and extract unique vendors
	var totalAmount int64
	vendorSet := make(map[string]struct{})

	for _, item := range cart.Items {
		totalAmount += item.Price * int64(item.Quantity)
		if item.VendorID != "" {
			vendorSet[item.VendorID] = struct{}{}
		}
	}

	var vendorIDs []string
	for vid := range vendorSet {
		vendorIDs = append(vendorIDs, vid)
	}

	// 3. Generate Order ID and Transfer Group for Stripe Connect
	// The Transfer Group ties the initial charge to the subsequent vendor payouts.
	orderID := fmt.Sprintf("ORD-%s-%d", uuid.New().String()[:8], time.Now().Unix())
	transferGroup := fmt.Sprintf("TG-%s", orderID)

	// 4. Create the PaymentIntent via Stripe Client
	req := stripe.CreatePaymentIntentReq{
		Amount:        totalAmount,
		Currency:      "usd", // Defaulting to USD; in a real app, this comes from the cart/region
		OrderID:       orderID,
		CustomerID:    customerID,
		VendorIDs:     vendorIDs,
		TransferGroup: transferGroup,
	}

	pi, err := m.stripeClient.CreatePaymentIntent(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize payment: %w", err)
	}

	// Note: At this point, we would typically persist a "Pending" Order to the database
	// and publish an `OrderCheckoutInitiated` event to Kafka for the OMS to track.

	// 5. Return the session details to the frontend (Client Plane)
	return &Session{
		OrderID:         orderID,
		PaymentIntentID: pi.ID,
		ClientSecret:    pi.ClientSecret,
		Amount:          totalAmount,
		Currency:        "usd",
	}, nil
}
