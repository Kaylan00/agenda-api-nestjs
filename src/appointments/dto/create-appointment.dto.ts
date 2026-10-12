import { Type } from 'class-transformer';
import { IsDate, IsInt, IsPositive } from 'class-validator';

export class CreateAppointmentDto {
  @IsInt()
  @IsPositive()
  professionalId: number;

  @IsInt()
  @IsPositive()
  serviceId: number;

  @IsInt()
  @IsPositive()
  clientId: number;

  /** Início do atendimento, em ISO 8601 (ex.: 2026-10-20T14:00:00.000Z). O fim é calculado. */
  @Type(() => Date)
  @IsDate()
  startsAt: Date;
}
