import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { Paginated, paginated } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_STATUSES, calculateEnd, canTransition } from './appointment-rules';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { ListAppointmentsQueryDto } from './dto/list-appointments-query.dto';

const WITH_RELATIONS = { client: true, service: true, professional: true } as const;

export type AppointmentWithRelations = Prisma.AppointmentGetPayload<{
  include: typeof WITH_RELATIONS;
}>;

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAppointmentDto): Promise<AppointmentWithRelations> {
    const { professionalId, serviceId, clientId, startsAt } = dto;

    if (startsAt.getTime() <= Date.now()) {
      throw new UnprocessableEntityException('Não é possível agendar no passado');
    }

    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException(`Serviço ${serviceId} não encontrado`);

    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Cliente ${clientId} não encontrado`);

    const endsAt = calculateEnd(startsAt, service.durationMinutes);

    // Checar conflito e inserir precisam acontecer "de uma vez". Sem isso, duas requisições
    // simultâneas poderiam passar na checagem e criar horários sobrepostos (condição de corrida).
    return this.prisma.$transaction(async (tx) => {
      // Trava a linha do profissional: requisições concorrentes para o MESMO profissional
      // esperam aqui em fila; as de outros profissionais seguem em paralelo.
      const locked = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM "Professional" WHERE id = ${professionalId} FOR UPDATE`;
      if (locked.length === 0) {
        throw new NotFoundException(`Profissional ${professionalId} não encontrado`);
      }

      // Dois intervalos se sobrepõem quando: inicioA < fimB E fimA > inicioB
      const conflict = await tx.appointment.findFirst({
        where: {
          professionalId,
          status: { in: ACTIVE_STATUSES },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
      });
      if (conflict) {
        throw new ConflictException('O profissional já possui um agendamento nesse horário');
      }

      return tx.appointment.create({
        data: {
          professionalId,
          serviceId,
          clientId,
          startsAt,
          endsAt,
          priceCents: service.priceCents, // guarda o preço da época da marcação
        },
        include: WITH_RELATIONS,
      });
    });
  }

  async findAll(query: ListAppointmentsQueryDto): Promise<Paginated<AppointmentWithRelations>> {
    const { professionalId, date, status, page, limit } = query;

    const where: Prisma.AppointmentWhereInput = { professionalId, status };
    if (date) {
      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
      where.startsAt = { gte: dayStart, lt: dayEnd };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        include: WITH_RELATIONS,
        orderBy: { startsAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return paginated(data, total, page, limit);
  }

  async findOne(id: number): Promise<AppointmentWithRelations> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: WITH_RELATIONS,
    });
    if (!appointment) throw new NotFoundException(`Agendamento ${id} não encontrado`);
    return appointment;
  }

  async updateStatus(id: number, newStatus: AppointmentStatus): Promise<AppointmentWithRelations> {
    const appointment = await this.findOne(id);

    if (!canTransition(appointment.status, newStatus)) {
      throw new UnprocessableEntityException(
        `Transição inválida: ${appointment.status} -> ${newStatus}`,
      );
    }

    // O "where status = atual" evita que duas mudanças simultâneas se atropelem:
    // se outra requisição mudou o status no meio do caminho, count vem 0.
    const { count } = await this.prisma.appointment.updateMany({
      where: { id, status: appointment.status },
      data: { status: newStatus },
    });
    if (count === 0) {
      throw new ConflictException('O status do agendamento mudou, tente novamente');
    }

    return this.findOne(id);
  }
}
