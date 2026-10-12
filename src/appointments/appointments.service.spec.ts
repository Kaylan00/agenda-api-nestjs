import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from './appointments.service';

/**
 * Testes unitários com o Prisma "falso" (mock): nada aqui toca o banco.
 * O que está sendo testado é a REGRA do service, não o Prisma.
 */
function createPrismaMock() {
  const mock = {
    service: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
    appointment: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  // A transação do mock executa o callback passando o próprio mock como "tx"
  // e, na forma de lista, apenas resolve todas as promessas.
  mock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? arg(mock) : Promise.all(arg as Promise<unknown>[]),
  );
  return mock;
}

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000);

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    const moduleRef = await Test.createTestingModule({
      providers: [AppointmentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AppointmentsService);
  });

  describe('create', () => {
    const dto = { professionalId: 1, serviceId: 2, clientId: 3, startsAt: FUTURE };

    function happyPath() {
      prisma.service.findUnique.mockResolvedValue({ id: 2, durationMinutes: 45, priceCents: 6000 });
      prisma.client.findUnique.mockResolvedValue({ id: 3 });
      prisma.$queryRaw.mockResolvedValue([{ id: 1 }]);
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.appointment.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 10, ...data }),
      );
    }

    it('calcula o fim pela duração do serviço e guarda o preço', async () => {
      happyPath();

      await service.create(dto);

      const { data } = prisma.appointment.create.mock.calls[0][0];
      expect(data.endsAt).toEqual(new Date(FUTURE.getTime() + 45 * 60_000));
      expect(data.priceCents).toBe(6000);
    });

    it('rejeita agendamento no passado (422) sem consultar o banco', async () => {
      const past = new Date(Date.now() - 60_000);

      await expect(service.create({ ...dto, startsAt: past })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prisma.service.findUnique).not.toHaveBeenCalled();
    });

    it('rejeita sobreposição com outro agendamento ativo (409)', async () => {
      happyPath();
      prisma.appointment.findFirst.mockResolvedValue({ id: 99 });

      await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });

    it('procura conflito só entre agendamentos ativos e com a regra de sobreposição', async () => {
      happyPath();

      await service.create(dto);

      const { where } = prisma.appointment.findFirst.mock.calls[0][0];
      const endsAt = new Date(FUTURE.getTime() + 45 * 60_000);
      expect(where).toEqual({
        professionalId: 1,
        status: { in: ['AGENDADO', 'CONFIRMADO'] },
        startsAt: { lt: endsAt },
        endsAt: { gt: FUTURE },
      });
    });

    it('trava a linha do profissional dentro da transação', async () => {
      happyPath();

      await service.create(dto);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const sql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join('');
      expect(sql).toContain('FOR UPDATE');
    });

    it('404 quando o serviço não existe', async () => {
      prisma.service.findUnique.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 quando o cliente não existe', async () => {
      prisma.service.findUnique.mockResolvedValue({ id: 2, durationMinutes: 30, priceCents: 1 });
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 quando o profissional não existe', async () => {
      happyPath();
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.create(dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('confirma um agendamento AGENDADO', async () => {
      prisma.appointment.findUnique
        .mockResolvedValueOnce({ id: 1, status: 'AGENDADO' })
        .mockResolvedValueOnce({ id: 1, status: 'CONFIRMADO' });
      prisma.appointment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.updateStatus(1, 'CONFIRMADO');

      expect(prisma.appointment.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: 'AGENDADO' },
        data: { status: 'CONFIRMADO' },
      });
      expect(result.status).toBe('CONFIRMADO');
    });

    it.each(['CONCLUIDO', 'CANCELADO'] as const)(
      'não permite sair de %s (422)',
      async (finalStatus) => {
        prisma.appointment.findUnique.mockResolvedValue({ id: 1, status: finalStatus });

        await expect(service.updateStatus(1, 'AGENDADO')).rejects.toBeInstanceOf(
          UnprocessableEntityException,
        );
        expect(prisma.appointment.updateMany).not.toHaveBeenCalled();
      },
    );

    it('não permite pular de AGENDADO direto para CONCLUIDO (422)', async () => {
      prisma.appointment.findUnique.mockResolvedValue({ id: 1, status: 'AGENDADO' });

      await expect(service.updateStatus(1, 'CONCLUIDO')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('409 se outra requisição mudou o status no meio do caminho', async () => {
      prisma.appointment.findUnique.mockResolvedValue({ id: 1, status: 'AGENDADO' });
      prisma.appointment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.updateStatus(1, 'CANCELADO')).rejects.toBeInstanceOf(ConflictException);
    });

    it('404 quando o agendamento não existe', async () => {
      prisma.appointment.findUnique.mockResolvedValue(null);

      await expect(service.updateStatus(1, 'CANCELADO')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('monta filtros, paginação e devolve o total', async () => {
      prisma.appointment.findMany.mockResolvedValue([{ id: 1 }]);
      prisma.appointment.count.mockResolvedValue(25);

      const result = await service.findAll({
        professionalId: 2,
        status: 'AGENDADO',
        date: '2030-05-10',
        page: 3,
        limit: 10,
      });

      const args = prisma.appointment.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
      expect(args.where.professionalId).toBe(2);
      expect(args.where.status).toBe('AGENDADO');
      expect(args.where.startsAt.gte).toEqual(new Date('2030-05-10T00:00:00.000Z'));
      expect(args.where.startsAt.lt).toEqual(new Date('2030-05-11T00:00:00.000Z'));
      expect(result.meta).toEqual({ total: 25, page: 3, limit: 10, totalPages: 3 });
    });
  });
});
