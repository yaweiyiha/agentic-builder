import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, KafkaContext, Payload } from '@nestjs/microservices';

// Define the expected payload structure for the payment.succeeded event
export interface PaymentSucceededPayload {
  orderId: string;
  transactionId: string;
  amount: number;
  currency: string;
  vendorId?: string;
  paymentMethod: string;
  timestamp: string;
}

@Controller('orders')
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);

  // In a real implementation, inject the OrdersService here
  // constructor(private readonly ordersService: OrdersService) {}

  /**
   * Consumes the 'payment.succeeded' event from Kafka.
   * Triggered by the Checkout/Payment service when a Stripe charge succeeds.
   */
  @EventPattern('payment.succeeded')
  async handlePaymentSucceeded(
    @Payload() message: PaymentSucceededPayload,
    @Ctx() context: KafkaContext,
  ) {
    const originalMessage = context.getMessage();
    const topic = context.getTopic();
    const partition = context.getPartition();

    this.logger.log(
      `Received event on topic [${topic}] partition [${partition}]: ${JSON.stringify(message)}`
    );

    try {
      // Validate payload
      if (!message.orderId || !message.transactionId) {
        throw new Error('Invalid payload: Missing orderId or transactionId');
      }

      // TODO: Delegate to OrdersService to update the order status
      // Example: await this.ordersService.updateStatus(message.orderId, 'PAID', message.transactionId);
      
      this.logger.log(`Successfully processed payment for order: ${message.orderId}`);
      
      // Note: In Kafka, offsets are automatically committed by NestJS after successful execution
      // unless configured for manual commit.
    } catch (error) {
      this.logger.error(
        `Failed to process payment.succeeded event for order ${message?.orderId}: ${error.message}`,
        error.stack,
      );
      
      // Depending on the error type, you might want to:
      // 1. Throw the error to trigger a retry mechanism
      // 2. Publish to a Dead Letter Queue (DLQ)
      // 3. Alert monitoring systems (e.g., Datadog)
    }
  }
}
