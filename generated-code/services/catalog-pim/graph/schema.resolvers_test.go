package graph_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	"github.com/aerocommerce/catalog-pim/graph"
	"github.com/aerocommerce/catalog-pim/graph/model"
)

// MockPricingEngine mocks the B2B pricing logic engine
type MockPricingEngine struct {
	mock.Mock
}

func (m *MockPricingEngine) CalculatePrice(ctx context.Context, productID string, customerGroupID *string, quantity int) (float64, error) {
	args := m.Called(ctx, productID, customerGroupID, quantity)
	return args.Get(0).(float64), args.Error(1)
}

func TestProductResolver_Price_B2BPricingLogic(testingT *testing.T) {
	t := testingT

	// Setup mock pricing engine
	mockEngine := new(MockPricingEngine)

	// Setup resolver with mocked engine
	resolver := &graph.Resolver{
		PricingEngine: mockEngine,
	}
	productResolver := resolver.Product()

	ctx := context.Background()
	product := &model.Product{
		ID:        "prod_123",
		BasePrice: 100.00,
	}

	t.Run("B2C Customer - No Group, Qty 1 - Returns Base Price", func(t *testing.T) {
		mockEngine.On("CalculatePrice", ctx, "prod_123", (*string)(nil), 1).
			Return(100.00, nil).Once()

		price, err := productResolver.Price(ctx, product, nil, 1)

		assert.NoError(t, err)
		assert.Equal(t, 100.00, price)
		mockEngine.AssertExpectations(t)
	})

	t.Run("B2B Customer - Wholesale Group, Qty 1 - Returns Group Base Price", func(t *testing.T) {
		wholesaleGroup := "group_wholesale"
		mockEngine.On("CalculatePrice", ctx, "prod_123", &wholesaleGroup, 1).
			Return(85.00, nil).Once()

		price, err := productResolver.Price(ctx, product, &wholesaleGroup, 1)

		assert.NoError(t, err)
		assert.Equal(t, 85.00, price)
		mockEngine.AssertExpectations(t)
	})

	t.Run("B2B Customer - Wholesale Group, Qty 100 - Returns Tiered Discount Price", func(t *testing.T) {
		wholesaleGroup := "group_wholesale"
		// Volume discount applied for qty >= 100
		mockEngine.On("CalculatePrice", ctx, "prod_123", &wholesaleGroup, 100).
			Return(75.00, nil).Once()

		price, err := productResolver.Price(ctx, product, &wholesaleGroup, 100)

		assert.NoError(t, err)
		assert.Equal(t, 75.00, price)
		mockEngine.AssertExpectations(t)
	})

	t.Run("B2B Customer - Enterprise Group, Qty 500 - Returns Deep Tiered Discount Price", func(t *testing.T) {
		enterpriseGroup := "group_enterprise"
		// Deep volume discount applied for qty >= 500
		mockEngine.On("CalculatePrice", ctx, "prod_123", &enterpriseGroup, 500).
			Return(60.00, nil).Once()

		price, err := productResolver.Price(ctx, product, &enterpriseGroup, 500)

		assert.NoError(t, err)
		assert.Equal(t, 60.00, price)
		mockEngine.AssertExpectations(t)
	})
}
