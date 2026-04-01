import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { VendorService } from '../vendors/vendors.service';
import { StripeService } from '../payments/stripe.service';
import { NotFoundException } from '@nestjs/common';

describe('OrdersService - Commission & Payout Logic', () => {
  let service: OrdersService;
  let vendorService: jest.Mocked<VendorService>;

  const mockOrderRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockOrderItemRepository = {
    find: jest.fn(),
  };

  const mockStripeService = {
    createTransfer: jest.fn(),
  };

  const mockVendorService = {
    getVendorById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: getRepositoryToken(Order),
          useValue: mockOrderRepository,
        },
        {
          provide: getRepositoryToken(OrderItem),
          useValue: mockOrderItemRepository,
        },
        {
          provide: VendorService,
          useValue: mockVendorService,
        },
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    vendorService = module.get(VendorService);

    jest.clearAllMocks();
  });

  describe('calculateOrderPayouts', () => {
    it('should calculate correct platform fee and vendor payout for a single item (10% commission)', async () => {
      // Arrange
      const orderId = 'order-123';
      const vendorId = 'vendor-1';
      
      // Amounts are in cents to avoid floating point issues (Stripe standard)
      // Item price: $100.00 (10000 cents), Qty: 1
      const mockOrder = {
        id: orderId,
        items: [
          { id: 'item-1', vendorId, price: 10000, quantity: 1 },
        ],
      };

      mockOrderRepository.findOne.mockResolvedValue(mockOrder);
      mockVendorService.getVendorById.mockResolvedValue({
        id: vendorId,
        commissionRate: 0.10, // 10%
      });

      // Act
      const payouts = await service.calculateOrderPayouts(orderId);

      // Assert
      expect(payouts).toHaveLength(1);
      expect(payouts[0]).toEqual({
        vendorId: 'vendor-1',
        subtotal: 10000,
        platformFee: 1000, // $10.00
        vendorPayout: 9000, // $90.00
      });
    });

    it('should accurately split payments for a multi-vendor order', async () => {
      // Arrange
      const orderId = 'order-multi-456';
      const mockOrder = {
        id: orderId,
        items: [
          { id: 'item-1', vendorId: 'vendor-A', price: 5000, quantity: 2 }, // $100.00 total
          { id: 'item-2', vendorId: 'vendor-B', price: 20000, quantity: 1 }, // $200.00 total
        ],
      };

      mockOrderRepository.findOne.mockResolvedValue(mockOrder);
      
      mockVendorService.getVendorById.mockImplementation(async (id: string) => {
        if (id === 'vendor-A') return { id, commissionRate: 0.15 }; // 15%
        if (id === 'vendor-B') return { id, commissionRate: 0.05 }; // 5%
        return null;
      });

      // Act
      const payouts = await service.calculateOrderPayouts(orderId);

      // Assert
      expect(payouts).toHaveLength(2);
      
      const payoutA = payouts.find(p => p.vendorId === 'vendor-A');
      expect(payoutA).toEqual({
        vendorId: 'vendor-A',
        subtotal: 10000,
        platformFee: 1500, // 15% of $100 = $15
        vendorPayout: 8500, // $85
      });

      const payoutB = payouts.find(p => p.vendorId === 'vendor-B');
      expect(payoutB).toEqual({
        vendorId: 'vendor-B',
        subtotal: 20000,
        platformFee: 1000, // 5% of $200 = $10
        vendorPayout: 19000, // $190
      });
    });

    it('should correctly round fractional cents in favor of the platform', async () => {
      // Arrange
      const orderId = 'order-rounding-789';
      const mockOrder = {
        id: orderId,
        items: [
          // $10.05 (1005 cents) * 1 = 1005 cents
          { id: 'item-1', vendorId: 'vendor-C', price: 1005, quantity: 1 },
        ],
      };

      mockOrderRepository.findOne.mockResolvedValue(mockOrder);
      mockVendorService.getVendorById.mockResolvedValue({
        id: 'vendor-C',
        commissionRate: 0.15, // 15%
      });

      // Act
      const payouts = await service.calculateOrderPayouts(orderId);

      // Assert
      // 1005 * 0.15 = 150.75 cents. 
      // Platform fee should round to nearest integer (151 cents).
      // Vendor payout should be 1005 - 151 = 854 cents.
      expect(payouts[0].platformFee).toBe(151);
      expect(payouts[0].vendorPayout).toBe(854);
      expect(payouts[0].platformFee + payouts[0].vendorPayout).toBe(1005); // Must equal exact subtotal
    });

    it('should aggregate multiple items from the same vendor before calculating commission', async () => {
      // Arrange
      const orderId = 'order-agg-012';
      const mockOrder = {
        id: orderId,
        items: [
          { id: 'item-1', vendorId: 'vendor-D', price: 1500, quantity: 2 }, // 3000
          { id: 'item-2', vendorId: 'vendor-D', price: 2500, quantity: 1 }, // 2500
        ],
      };

      mockOrderRepository.findOne.mockResolvedValue(mockOrder);
      mockVendorService.getVendorById.mockResolvedValue({
        id: 'vendor-D',
        commissionRate: 0.20, // 20%
      });

      // Act
      const payouts = await service.calculateOrderPayouts(orderId);

      // Assert
      expect(payouts).toHaveLength(1); // Grouped into one payout per vendor
      expect(payouts[0]).toEqual({
        vendorId: 'vendor-D',
        subtotal: 5500, // 3000 + 2500
        platformFee: 1100, // 20% of 5500
        vendorPayout: 4400, // 5500 - 1100
      });
    });

    it('should handle 0% commission rate correctly', async () => {
      // Arrange
      const orderId = 'order-zero-comm';
      const mockOrder = {
        id: orderId,
        items: [
          { id: 'item-1', vendorId: 'vendor-E', price: 5000, quantity: 1 },
        ],
      };

      mockOrderRepository.findOne.mockResolvedValue(mockOrder);
      mockVendorService.getVendorById.mockResolvedValue({
        id: 'vendor-E',
        commissionRate: 0.0, // 0%
      });

      // Act
      const payouts = await service.calculateOrderPayouts(orderId);

      // Assert
      expect(payouts[0].platformFee).toBe(0);
      expect(payouts[0].vendorPayout).toBe(5000);
    });

    it('should throw NotFoundException if order does not exist', async () => {
      // Arrange
      mockOrderRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.calculateOrderPayouts('invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('should throw an error if vendor is not found for an item', async () => {
      // Arrange
      const mockOrder = {
        id: 'order-missing-vendor',
        items: [
          { id: 'item-1', vendorId: 'missing-vendor', price: 1000, quantity: 1 },
        ],
      };

      mockOrderRepository.findOne.mockResolvedValue(mockOrder);
      mockVendorService.getVendorById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.calculateOrderPayouts('order-missing-vendor')).rejects.toThrow(
        'Vendor missing-vendor not found for commission calculation'
      );
    });
  });
});
