import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface OrderItemDto {
  productId: string;
  vendorId: string;
  quantity: number;
  price: number;
}

export interface CreateOrderDto {
  customerId: string;
  items: OrderItemDto[];
  shippingAddressId?: string;
  billingAddressId?: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  
  // 10% Platform Commission (FR-MVM02, FR-MVM03)
  private readonly PLATFORM_COMMISSION_RATE = 0.10; 

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a Parent Order, splits it into SubOrders by vendor, 
   * and calculates the platform commission within a Prisma transaction.
   */
  async createOrder(dto: CreateOrderDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Group items by vendorId
        const vendorItemsMap = new Map<string, OrderItemDto[]>();
        let totalOrderAmount = 0;

        for (const item of dto.items) {
          if (!vendorItemsMap.has(item.vendorId)) {
            vendorItemsMap.set(item.vendorId, []);
          }
          vendorItemsMap.get(item.vendorId)!.push(item);
          
          // Calculate total parent order amount
          totalOrderAmount += item.price * item.quantity;
        }

        // 2. Prepare SubOrders data
        const subOrdersData = Array.from(vendorItemsMap.entries()).map(([vendorId, items]) => {
          // Calculate SubOrder total
          const subTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
          
          // Calculate 10% platform commission and vendor payout
          // Using Math.round to handle floating point precision issues (assuming amounts are in cents or standard decimals)
          const platformFee = Number((subTotal * this.PLATFORM_COMMISSION_RATE).toFixed(2));
          const vendorPayout = Number((subTotal - platformFee).toFixed(2));

          return {
            vendorId,
            totalAmount: subTotal,
            platformFee,
            vendorPayout,
            status: 'PENDING',
            items: {
              create: items.map(item => ({
                productId: item.productId,
                quantity: item.quantity,
                price: item.price
              }))
            }
          };
        });

        // 3. Create Parent Order and nested SubOrders/Items
        const parentOrder = await tx.order.create({
          data: {
            customerId: dto.customerId,
            totalAmount: Number(totalOrderAmount.toFixed(2)),
            status: 'PENDING',
            shippingAddressId: dto.shippingAddressId,
            billingAddressId: dto.billingAddressId,
            subOrders: {
              create: subOrdersData
            }
          },
          include: {
            subOrders: {
              include: {
                items: true
              }
            }
          }
        });

        this.logger.log(`Successfully created Parent Order ${parentOrder.id} with ${subOrdersData.length} SubOrders.`);
        
        return parentOrder;
      });
    } catch (error) {
      this.logger.error(`Failed to create order for customer ${dto.customerId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Order creation failed during transaction processing');
    }
  }
}
