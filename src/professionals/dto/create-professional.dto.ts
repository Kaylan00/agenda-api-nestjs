import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateProfessionalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;
}
