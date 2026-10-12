import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  /** Duração em minutos (de 5 minutos a 8 horas). */
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes: number;

  /** Preço em centavos: R$ 45,00 vira 4500. */
  @IsInt()
  @Min(0)
  priceCents: number;
}
