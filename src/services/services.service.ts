import { Injectable, NotFoundException } from '@nestjs/common';
import { Service } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

/** Catálogo de serviços oferecidos (corte, barba...). Não confundir com "service" do Nest. */
@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateServiceDto): Promise<Service> {
    return this.prisma.service.create({ data: dto });
  }

  findAll(): Promise<Service[]> {
    return this.prisma.service.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: number): Promise<Service> {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException(`Serviço ${id} não encontrado`);
    return service;
  }

  update(id: number, dto: UpdateServiceDto): Promise<Service> {
    return this.prisma.service.update({ where: { id }, data: dto });
  }

  remove(id: number): Promise<Service> {
    return this.prisma.service.delete({ where: { id } });
  }
}
