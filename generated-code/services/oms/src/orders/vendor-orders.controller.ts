import {
  Controller,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { VendorOrdersService } from './vendor-orders.service';
import { UpdateTrackingDto } from './dto/update-tracking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Vendor Orders')
@ApiBearerAuth()
@Controller('vendor/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('vendor')
export class VendorOrdersController {
  constructor(private readonly vendorOrdersService: VendorOrdersService) {}

  @Patch(':subOrderId/tracking')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit tracking number and update order status',
    description: 'Allows a vendor to submit a tracking number for a specific sub-order. This automatically updates the sub-order status to "Shipped".',
  })
  @ApiParam({
    name: 'subOrderId',
    type: 'string',
    format: 'uuid',
    description: 'The UUID of the sub-order',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tracking information successfully updated and status set to Shipped.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Vendor does not have permission to modify this sub-order.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Sub-order not found.',
  })
  async updateTracking(
    @Request() req,
    @Param('subOrderId', ParseUUIDPipe) subOrderId: string,
    @Body() updateTrackingDto: UpdateTrackingDto,
  ) {
    // Extract vendorId from the authenticated user's JWT payload
    const vendorId = req.user.vendorId;

    return this.vendorOrdersService.addTrackingAndUpdateStatus(
      vendorId,
      subOrderId,
      updateTrackingDto,
    );
  }
}
