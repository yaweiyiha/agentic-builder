import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientKafka } from '@nestjs/microservices';
import { SubOrder } from './entities/sub-order.entity';
import { UpdateTrackingDto } from './dto/update-tracking.dto';

@Injectable()
export class VendorOrdersService {
  constructor(
    @InjectRepository(SubOrder)
    private readonly subOrderRepository: Repository<SubOrder>,
    @Inject('KAFKA_SERVICE')
    private readonly kafkaClient: ClientKafka,
  ) {}

  async addTrackingAndUpdateStatus(
    vendorId: string,
    subOrderId: string,
    updateTrackingDto: UpdateTrackingDto,
  ): Promise<SubOrder> {
    const subOrder = await this.subOrderRepository.findOne({
      where: { id: subOrderId },
      relations: ['order', 'items'],
    });

    if (!subOrder) {
      throw new NotFoundException(`SubOrder with ID ${subOrderId} not found`);
    }

    if (subOrder.vendorId !== vendorId) {
      throw new ForbiddenException('You do not have permission to update this sub-order');
    }

    if (subOrder.status === 'Shipped' || subOrder.status === 'Delivered') {
      throw new BadRequestException(`SubOrder is already marked as ${subOrder.status}`);
    }

    if (subOrder.status === 'Cancelled' || subOrder.status === 'Refunded') {
      throw new BadRequestException(`Cannot ship a ${subOrder.status} sub-order`);
    }

    // Update tracking details and status
    subOrder.trackingNumber = updateTrackingDto.trackingNumber;
    subOrder.carrier = updateTrackingDto.carrier;
    subOrder.status = 'Shipped';
    subOrder.shippedAt = new Date();

    const updatedSubOrder = await this.subOrderRepository.save(subOrder);

    // Dispatch event to Kafka for asynchronous processing (e.g., email notifications, webhooks)
    this.kafkaClient.emit('order.suborder.shipped', {
      subOrderId: updatedSubOrder.id,
      orderId: updatedSubOrder.order.id,
      vendorId: updatedSubOrder.vendorId,
      trackingNumber: updatedSubOrder.trackingNumber,
      carrier: updatedSubOrder.carrier,
      shippedAt: updatedSubOrder.shippedAt,
    });

    return updatedSubOrder;
  }
}
