import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportPeriodQueryDto } from './dto/report-period-query.dto';

export interface RevenueByProfessional {
  professionalId: number;
  name: string;
  appointments: number;
  revenueCents: number;
}

export interface RevenueByService {
  serviceId: number;
  name: string;
  appointments: number;
  revenueCents: number;
}

export interface RevenueReport {
  from: string;
  to: string;
  totalAppointments: number;
  totalRevenueCents: number;
  byProfessional: RevenueByProfessional[];
  byService: RevenueByService[];
}

export interface OccupancyRow {
  professionalId: number;
  name: string;
  appointments: number;
  bookedMinutes: number;
}

/** Resolve o período em [from, to): se `to` vier só como data, inclui o dia inteiro. */
export function resolvePeriod({ from, to }: ReportPeriodQueryDto): { start: Date; end: Date } {
  const start = new Date(from);
  let end = new Date(to);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    end = new Date(end.getTime() + 24 * 60 * 60_000);
  }
  if (end.getTime() <= start.getTime()) {
    throw new BadRequestException('"to" deve ser depois de "from"');
  }
  return { start, end };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Faturamento dos atendimentos CONCLUÍDOS no período, somado por profissional e por serviço.
   * Usa SQL explícito (JOIN + GROUP BY). COUNT/SUM voltam como bigint no Postgres,
   * por isso o ::int (o Prisma devolveria BigInt, que não vira JSON).
   */
  async revenue(query: ReportPeriodQueryDto): Promise<RevenueReport> {
    const { start, end } = resolvePeriod(query);

    const byProfessional = await this.prisma.$queryRaw<RevenueByProfessional[]>`
      SELECT
        p.id                                   AS "professionalId",
        p.name                                 AS "name",
        COUNT(a.id)::int                       AS "appointments",
        COALESCE(SUM(a."priceCents"), 0)::int  AS "revenueCents"
      FROM "Appointment" a
      JOIN "Professional" p ON p.id = a."professionalId"
      WHERE a.status = 'CONCLUIDO'
        AND a."startsAt" >= ${start}
        AND a."startsAt" <  ${end}
      GROUP BY p.id, p.name
      ORDER BY "revenueCents" DESC, p.name`;

    const byService = await this.prisma.$queryRaw<RevenueByService[]>`
      SELECT
        s.id                                   AS "serviceId",
        s.name                                 AS "name",
        COUNT(a.id)::int                       AS "appointments",
        COALESCE(SUM(a."priceCents"), 0)::int  AS "revenueCents"
      FROM "Appointment" a
      JOIN "Service" s ON s.id = a."serviceId"
      WHERE a.status = 'CONCLUIDO'
        AND a."startsAt" >= ${start}
        AND a."startsAt" <  ${end}
      GROUP BY s.id, s.name
      ORDER BY "revenueCents" DESC, s.name`;

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      totalAppointments: byProfessional.reduce((sum, row) => sum + row.appointments, 0),
      totalRevenueCents: byProfessional.reduce((sum, row) => sum + row.revenueCents, 0),
      byProfessional,
      byService,
    };
  }

  /**
   * Ocupação: minutos reservados por profissional (agendado, confirmado ou concluído).
   * LEFT JOIN para que profissionais sem nenhum atendimento no período apareçam com zero.
   */
  async occupancy(query: ReportPeriodQueryDto): Promise<OccupancyRow[]> {
    const { start, end } = resolvePeriod(query);

    return this.prisma.$queryRaw<OccupancyRow[]>`
      SELECT
        p.id                                   AS "professionalId",
        p.name                                 AS "name",
        COUNT(a.id)::int                       AS "appointments",
        COALESCE(SUM(EXTRACT(EPOCH FROM (a."endsAt" - a."startsAt")) / 60), 0)::int
                                               AS "bookedMinutes"
      FROM "Professional" p
      LEFT JOIN "Appointment" a
        ON a."professionalId" = p.id
       AND a.status IN ('AGENDADO', 'CONFIRMADO', 'CONCLUIDO')
       AND a."startsAt" >= ${start}
       AND a."startsAt" <  ${end}
      GROUP BY p.id, p.name
      ORDER BY p.name`;
  }
}
