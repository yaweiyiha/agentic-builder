package stripe

import (
	"context"
	"fmt"
	"strings"

	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/paymentintent"
)

// CreatePaymentIntentReq encapsulates the data needed to create a Stripe PaymentIntent
// with multi-vendor routing support.
type CreatePaymentIntentReq struct {
	Amount        int64
	Currency      string
	OrderID       string
	CustomerID    string
	VendorIDs     []string
	TransferGroup string
}

// Client defines the interface for interacting with the Stripe API.
type Client interface {
	CreatePaymentIntent(ctx context.Context, req CreatePaymentIntentReq) (*stripe.PaymentIntent, error)
}

type stripeClient struct {
	secretKey string
}

// NewStripeClient initializes a new Stripe API client.
func NewStripeClient(secretKey string) Client {
	stripe.Key = secretKey
	return &stripeClient{
		secretKey: secretKey,
	}
}

// CreatePaymentIntent calls the Stripe API to create a PaymentIntent.
// It attaches multi-vendor routing metadata and a TransferGroup to facilitate
// Stripe Connect separate charges and transfers (US-10).
func (c *stripeClient) CreatePaymentIntent(ctx context.Context, req CreatePaymentIntentReq) (*stripe.PaymentIntent, error) {
	// Join vendor IDs for metadata storage (Stripe metadata values are limited to 500 chars)
	// In a massive multi-vendor cart, you might need to truncate or store a reference ID instead.
	vendorList := strings.Join(req.VendorIDs, ",")
	if len(vendorList) > 500 {
		vendorList = vendorList[:497] + "..."
	}

	params := &stripe.PaymentIntentParams{
		Amount:   stripe.Int64(req.Amount),
		Currency: stripe.String(strings.ToLower(req.Currency)),
		// TransferGroup is essential for multi-vendor split payments.
		// It links the incoming PaymentIntent with subsequent Transfers to connected vendor accounts.
		TransferGroup: stripe.String(req.TransferGroup),
		Metadata: map[string]string{
			"order_id":     req.OrderID,
			"vendor_ids":   vendorList,
			"routing_type": "multi-vendor-split",
		},
	}

	if req.CustomerID != "" {
		params.Customer = stripe.String(req.CustomerID)
	}

	// Pass the context for cancellation and timeout propagation
	params.SetContext(ctx)

	pi, err := paymentintent.New(params)
	if err != nil {
		return nil, fmt.Errorf("failed to create stripe payment intent: %w", err)
	}

	return pi, nil
}
