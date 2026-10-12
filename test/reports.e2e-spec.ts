import {
  createScenario,
  createTestApp,
  futureDate,
  resetDatabase,
  Scenario,
  TestContext,
} from './helpers';

describe('Relatórios (e2e)', () => {
  let ctx: TestContext;
  let s: Scenario;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    s = await createScenario(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** Cria um agendamento pela API e, opcionalmente, leva até o status final. */
  async function book(
    professionalId: number,
    serviceId: number,
    startsAt: Date,
    finalStatus?: string,
  ) {
    const res = await ctx
      .http()
      .post('/appointments')
      .send({ professionalId, serviceId, clientId: s.clientId, startsAt: startsAt.toISOString() })
      .expect(201);
    const id = res.body.id as number;

    const path: Record<string, string[]> = {
      CONCLUIDO: ['CONFIRMADO', 'CONCLUIDO'],
      CANCELADO: ['CANCELADO'],
    };
    for (const status of path[finalStatus ?? ''] ?? []) {
      await ctx.http().patch(`/appointments/${id}/status`).send({ status }).expect(200);
    }
    return id;
  }

  const day = (days: number) => futureDate(days, 0).toISOString().slice(0, 10);

  describe('GET /reports/faturamento', () => {
    it('soma só atendimentos concluídos, por profissional e por serviço', async () => {
      // Thor: corte (4500) + combo (7500) concluídos; um cancelado e um só agendado ficam de fora
      await book(s.professionalId, s.serviceId, futureDate(2, 9), 'CONCLUIDO');
      await book(s.professionalId, s.longServiceId, futureDate(2, 10), 'CONCLUIDO');
      await book(s.professionalId, s.serviceId, futureDate(2, 12), 'CANCELADO');
      await book(s.professionalId, s.serviceId, futureDate(2, 13));
      // Bruna: um corte concluído
      await book(s.otherProfessionalId, s.serviceId, futureDate(2, 9), 'CONCLUIDO');
      // Fora do período (dia +10)
      await book(s.professionalId, s.serviceId, futureDate(10, 9), 'CONCLUIDO');

      const res = await ctx
        .http()
        .get(`/reports/faturamento?from=${day(1)}&to=${day(3)}`)
        .expect(200);

      expect(res.body.totalAppointments).toBe(3);
      expect(res.body.totalRevenueCents).toBe(4500 + 7500 + 4500);
      expect(res.body.byProfessional).toEqual([
        { professionalId: s.professionalId, name: 'Thor', appointments: 2, revenueCents: 12000 },
        {
          professionalId: s.otherProfessionalId,
          name: 'Bruna',
          appointments: 1,
          revenueCents: 4500,
        },
      ]);
      expect(res.body.byService).toEqual([
        { serviceId: s.serviceId, name: 'Corte', appointments: 2, revenueCents: 9000 },
        { serviceId: s.longServiceId, name: 'Corte + Barba', appointments: 1, revenueCents: 7500 },
      ]);
    });

    it('usa o preço da época do agendamento, mesmo se o catálogo mudar depois', async () => {
      await book(s.professionalId, s.serviceId, futureDate(2, 9), 'CONCLUIDO');
      await ctx.http().patch(`/services/${s.serviceId}`).send({ priceCents: 9900 }).expect(200);

      const res = await ctx
        .http()
        .get(`/reports/faturamento?from=${day(1)}&to=${day(3)}`)
        .expect(200);

      expect(res.body.totalRevenueCents).toBe(4500);
    });

    it('período sem atendimentos devolve zeros e listas vazias', async () => {
      const res = await ctx
        .http()
        .get(`/reports/faturamento?from=${day(20)}&to=${day(21)}`)
        .expect(200);

      expect(res.body).toMatchObject({
        totalAppointments: 0,
        totalRevenueCents: 0,
        byProfessional: [],
        byService: [],
      });
    });

    it('400 sem parâmetros, com data inválida ou período invertido', async () => {
      await ctx.http().get('/reports/faturamento').expect(400);
      await ctx.http().get('/reports/faturamento?from=abc&to=2030-01-01').expect(400);
      await ctx
        .http()
        .get(`/reports/faturamento?from=${day(5)}&to=${day(1)}`)
        .expect(400);
    });
  });

  describe('GET /reports/ocupacao', () => {
    it('soma minutos reservados e inclui profissional sem atendimento', async () => {
      await book(s.professionalId, s.serviceId, futureDate(2, 9)); // 30 min
      await book(s.professionalId, s.longServiceId, futureDate(2, 10), 'CONCLUIDO'); // 60 min
      await book(s.professionalId, s.serviceId, futureDate(2, 12), 'CANCELADO'); // não conta

      const res = await ctx
        .http()
        .get(`/reports/ocupacao?from=${day(1)}&to=${day(3)}`)
        .expect(200);

      expect(res.body).toEqual([
        { professionalId: s.otherProfessionalId, name: 'Bruna', appointments: 0, bookedMinutes: 0 },
        { professionalId: s.professionalId, name: 'Thor', appointments: 2, bookedMinutes: 90 },
      ]);
    });
  });
});
