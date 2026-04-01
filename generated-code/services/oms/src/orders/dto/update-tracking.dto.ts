import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTrackingDto {
  @ApiProperty({
    description: 'The tracking number provided by the shipping carrier',
    example: '1Z9999999999999999',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  trackingNumber: string;

  @ApiProperty({
    description: 'The name of the shipping carrier (e.g., UPS, FedEx, USPS)',
    example: 'UPS',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  carrier: string;
}
