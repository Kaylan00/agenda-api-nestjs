import { AppointmentStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateStatusDto {
  @IsEnum(AppointmentStatus)
  status: AppointmentStatus;
}
