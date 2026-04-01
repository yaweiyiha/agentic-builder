package checkout_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	"github.com/aerocommerce/cart-checkout/checkout"
)

// MockMutex represents a mocked Redis Redlock mutex
type MockMutex struct {
	mock.Mock
}

func (m *MockMutex) Unlock(ctx context.Context) (bool, error) {
	args := m.Called(ctx)
	return args.Bool(0), args.Error(1)
}

// MockLockClient represents a mocked Redis Redlock client
type MockLockClient struct {
	mock.Mock
}

func (m *MockLockClient) Obtain(ctx context.Context, key string, ttl time.Duration) (checkout.Mutex, error) {
	args := m.Called(ctx, key, ttl)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(checkout.Mutex), args.Error(1)
}

// MockInventoryService mocks the inventory reservation logic
type MockInventoryService struct {
	mock.Mock
}

func (m *MockInventoryService) ReserveItems(ctx context.Context, cartID string) error {
	args := m.Called(ctx, cartID)
	return args.Error(0)
}

func TestCheckoutManager_ProcessCheckout_RedlockAcquisition(testingT *testing.T) {
	t := testingT

	ctx := context.Background()
	cartID := "cart_98765"
	lockKey := "inventory_lock:cart_98765"
	lockTTL := 5 * time.Second

	t.Run("Successfully acquires lock, processes checkout, and releases lock", func(t *testing.T) {
		mockLockClient := new(MockLockClient)
		mockMutex := new(MockMutex)
		mockInventory := new(MockInventoryService)

		manager := checkout.NewManager(mockLockClient, mockInventory)

		// Expect lock acquisition
		mockLockClient.On("Obtain", ctx, lockKey, lockTTL).Return(mockMutex, nil).Once()
		
		// Expect inventory reservation to succeed
		mockInventory.On("ReserveItems", ctx, cartID).Return(nil).Once()
		
		// Expect lock release
		mockMutex.On("Unlock", ctx).Return(true, nil).Once()

		err := manager.ProcessCheckout(ctx, cartID)

		assert.NoError(t, err)
		mockLockClient.AssertExpectations(t)
		mockInventory.AssertExpectations(t)
		mockMutex.AssertExpectations(t)
	})

	t.Run("Fails to acquire lock - Inventory currently locked by another process", func(t *testing.T) {
		mockLockClient := new(MockLockClient)
		mockInventory := new(MockInventoryService)

		manager := checkout.NewManager(mockLockClient, mockInventory)

		// Simulate Redlock acquisition failure (e.g., lock already held)
		mockLockClient.On("Obtain", ctx, lockKey, lockTTL).Return(nil, checkout.ErrLockNotObtained).Once()

		err := manager.ProcessCheckout(ctx, cartID)

		assert.ErrorIs(t, err, checkout.ErrLockNotObtained)
		
		// Inventory should NOT be called if lock fails
		mockInventory.AssertNotCalled(t, "ReserveItems", ctx, cartID)
		mockLockClient.AssertExpectations(t)
	})

	t.Run("Acquires lock but inventory reservation fails, ensures lock is still released", func(t *testing.T) {
		mockLockClient := new(MockLockClient)
		mockMutex := new(MockMutex)
		mockInventory := new(MockInventoryService)

		manager := checkout.NewManager(mockLockClient, mockInventory)

		// Expect lock acquisition
		mockLockClient.On("Obtain", ctx, lockKey, lockTTL).Return(mockMutex, nil).Once()
		
		// Simulate inventory reservation failure (e.g., out of stock)
		errOutOfStock := errors.New("insufficient inventory")
		mockInventory.On("ReserveItems", ctx, cartID).Return(errOutOfStock).Once()
		
		// Expect lock release EVEN IF inventory fails (defer unlock)
		mockMutex.On("Unlock", ctx).Return(true, nil).Once()

		err := manager.ProcessCheckout(ctx, cartID)

		assert.ErrorIs(t, err, errOutOfStock)
		mockLockClient.AssertExpectations(t)
		mockInventory.AssertExpectations(t)
		mockMutex.AssertExpectations(t)
	})
}
