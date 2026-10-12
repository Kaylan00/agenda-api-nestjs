import { Injectable, NotFoundException } from '@nestjs/common';
import { Client } from '@prisma/client';
import { PaginationQueryDto, Paginated, paginated } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  // email é @unique no schema: duplicado gera P2002, que o filtro global converte em 409.
  create(dto: CreateClientDto): Promise<Client> {
    return this.prisma.client.create({ data: dto });
  }

  async findAll({ page, limit }: PaginationQueryDto): Promise<Paginated<Client>> {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.client.count(),
    ]);
    return paginated(data, total, page, limit);
  }

  async findOne(id: number): Promise<Client> {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException(`Cliente ${id} não encontrado`);
    return client;
  }

  update(id: number, dto: UpdateClientDto): Promise<Client> {
    return this.prisma.client.update({ where: { id }, data: dto });
  }

  remove(id: number): Promise<Client> {
    return this.prisma.client.delete({ where: { id } });
  }
}
