import { Injectable, NotFoundException } from '@nestjs/common';
import { Professional } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProfessionalDto } from './dto/create-professional.dto';
import { UpdateProfessionalDto } from './dto/update-professional.dto';

@Injectable()
export class ProfessionalsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateProfessionalDto): Promise<Professional> {
    return this.prisma.professional.create({ data: dto });
  }

  findAll(): Promise<Professional[]> {
    return this.prisma.professional.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: number): Promise<Professional> {
    const professional = await this.prisma.professional.findUnique({ where: { id } });
    if (!professional) throw new NotFoundException(`Profissional ${id} não encontrado`);
    return professional;
  }

  // update/delete lançam P2025 se o id não existir; o filtro global converte em 404.
  update(id: number, dto: UpdateProfessionalDto): Promise<Professional> {
    return this.prisma.professional.update({ where: { id }, data: dto });
  }

  remove(id: number): Promise<Professional> {
    return this.prisma.professional.delete({ where: { id } });
  }
}
