import {
  createScenario,
  createTestApp,
  futureDate,
  resetDatabase,
  Scenario,
  TestContext,
} from './helpers';

describe('Agendamentos (e2e)', () => {
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

  function book(startsAt: Date, overrides: Partial<Scenario> = {}) {
    return ctx
      .http()
      .post('/appointments')
      .send({
        professionalId: s.professionalId,
        serviceId: s.serviceId,
        clientId: s.clientId,
        startsAt: startsAt.toISOString(),
        ...overrides,
      });
  }

  describe('POST /appointments', () => {
    it('cria o agendamento e calcula o fim pela duração do serviço', async () => {
      const start = futureDate(2, 14);

      const res = await book(start).expect(201);

      expect(res.body).toMatchObject({
        status: 'AGENDADO',
        priceCents: 4500,
        startsAt: start.toISOString(),
        endsAt: futureDate(2, 14, 30).toISOString(),
      });
    });

    it('409 ao sobrepor outro agendamento ativo do mesmo profissional', async () => {
      await book(futureDate(2, 14)).expect(201); // 14:00-14:30

      const res = await book(futureDate(2, 14, 15)).expect(409); // 14:15-14:45

      expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict' });
    });

    it('409 quando o novo horário engloba um existente (serviço de 60 min)', async () => {
      await book(futureDate(2, 14, 15)).expect(201); // 14:15-14:45

      await book(futureDate(2, 14), { serviceId: s.longServiceId }).expect(409); // 14:00-15:00
    });

    it('permite horários colados (fim de um = início do outro)', async () => {
      await book(futureDate(2, 14)).expect(201); // 14:00-14:30

      await book(futureDate(2, 14, 30)).expect(201); // 14:30-15:00
    });

    it('permite o mesmo horário para outro profissional', async () => {
      await book(futureDate(2, 14)).expect(201);

      await book(futureDate(2, 14), { professionalId: s.otherProfessionalId }).expect(201);
    });

    it('agendamento cancelado libera o horário', async () => {
      const first = await book(futureDate(2, 14)).expect(201);
      await ctx
        .http()
        .patch(`/appointments/${first.body.id}/status`)
        .send({ status: 'CANCELADO' })
        .expect(200);

      await book(futureDate(2, 14)).expect(201);
    });

    it('requisições simultâneas pelo mesmo horário: só uma vence (sem corrida)', async () => {
      const start = futureDate(3, 10);

      const responses = await Promise.all(Array.from({ length: 8 }, () => book(start)));

      const codes = responses.map((r) => r.status).sort();
      expect(codes.filter((c) => c === 201)).toHaveLength(1);
      expect(codes.filter((c) => c === 409)).toHaveLength(7);
      expect(await ctx.prisma.appointment.count()).toBe(1);
    });

    it('422 para horário no passado', async () => {
      const res = await book(new Date(Date.now() - 60 * 60_000)).expect(422);

      expect(res.body.message).toMatch(/passado/);
    });

    it('404 para profissional, serviço e cliente inexistentes', async () => {
      await book(futureDate(2, 9), { professionalId: 9999 }).expect(404);
      await book(futureDate(2, 9), { serviceId: 9999 }).expect(404);
      await book(futureDate(2, 9), { clientId: 9999 }).expect(404);
    });

    it('400 com lista de erros para payload inválido ou com campos extras', async () => {
      const res = await ctx
        .http()
        .post('/appointments')
        .send({ professionalId: 'abc', startsAt: 'ontem', hack: true })
        .expect(400);

      expect(Array.isArray(res.body.message)).toBe(true);
      expect(res.body.message.join(' ')).toMatch(/hack should not exist/);
    });
  });

  describe('PATCH /appointments/:id/status', () => {
    async function createAppointment() {
      const res = await book(futureDate(2, 14)).expect(201);
      return res.body.id as number;
    }
    const patch = (id: number, status: string) =>
      ctx.http().patch(`/appointments/${id}/status`).send({ status });

    it('percorre o fluxo AGENDADO -> CONFIRMADO -> CONCLUIDO', async () => {
      const id = await createAppointment();

      const confirmed = await patch(id, 'CONFIRMADO').expect(200);
      expect(confirmed.body.status).toBe('CONFIRMADO');

      const done = await patch(id, 'CONCLUIDO').expect(200);
      expect(done.body.status).toBe('CONCLUIDO');
    });

    it('cancela um agendamento', async () => {
      const id = await createAppointment();

      const res = await patch(id, 'CANCELADO').expect(200);

      expect(res.body.status).toBe('CANCELADO');
    });

    it('422 ao pular etapa (AGENDADO -> CONCLUIDO)', async () => {
      const id = await createAppointment();

      const res = await patch(id, 'CONCLUIDO').expect(422);

      expect(res.body.message).toMatch(/AGENDADO -> CONCLUIDO/);
    });

    it('422 ao tentar sair de um estado final', async () => {
      const id = await createAppointment();
      await patch(id, 'CANCELADO').expect(200);

      await patch(id, 'CONFIRMADO').expect(422);
      await patch(id, 'AGENDADO').expect(422);
    });

    it('400 para status inexistente e 404 para id inexistente', async () => {
      const id = await createAppointment();

      await patch(id, 'QUALQUER').expect(400);
      await patch(9999, 'CANCELADO').expect(404);
    });
  });

  describe('GET /appointments/:id', () => {
    it('retorna o agendamento com cliente, serviço e profissional', async () => {
      const created = await book(futureDate(2, 14)).expect(201);

      const res = await ctx.http().get(`/appointments/${created.body.id}`).expect(200);

      expect(res.body.client).toMatchObject({ name: 'Lucas', email: 'lucas@example.com' });
      expect(res.body.service).toMatchObject({ name: 'Corte', durationMinutes: 30 });
      expect(res.body.professional).toMatchObject({ name: 'Thor' });
    });

    it('404 e 400 para ids inválidos', async () => {
      await ctx.http().get('/appointments/9999').expect(404);
      await ctx.http().get('/appointments/abc').expect(400);
    });
  });

  describe('GET /appointments (filtros e paginação)', () => {
    beforeEach(async () => {
      // Thor: 5 atendimentos no dia +2 (9h..13h); Bruna: 2 no dia +2 e 1 no dia +3
      for (let hour = 9; hour < 14; hour++) {
        await book(futureDate(2, hour)).expect(201);
      }
      await book(futureDate(2, 9), { professionalId: s.otherProfessionalId }).expect(201);
      await book(futureDate(2, 10), { professionalId: s.otherProfessionalId }).expect(201);
      await book(futureDate(3, 9), { professionalId: s.otherProfessionalId }).expect(201);
    });

    it('pagina e informa o total', async () => {
      const res = await ctx
        .http()
        .get(`/appointments?professionalId=${s.professionalId}&page=2&limit=2`)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toEqual({ total: 5, page: 2, limit: 2, totalPages: 3 });
      // ordenado por início: a página 2 começa no 3º atendimento (11h)
      expect(res.body.data[0].startsAt).toBe(futureDate(2, 11).toISOString());
      expect(res.body.data[0].client.name).toBe('Lucas');
    });

    it('filtra por profissional e por dia', async () => {
      const day = futureDate(3, 0).toISOString().slice(0, 10);

      const res = await ctx
        .http()
        .get(`/appointments?professionalId=${s.otherProfessionalId}&date=${day}`)
        .expect(200);

      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].professionalId).toBe(s.otherProfessionalId);
    });

    it('filtra por status', async () => {
      const first = await ctx.http().get('/appointments?limit=1').expect(200);
      await ctx
        .http()
        .patch(`/appointments/${first.body.data[0].id}/status`)
        .send({ status: 'CANCELADO' })
        .expect(200);

      const cancelados = await ctx.http().get('/appointments?status=CANCELADO').expect(200);
      const agendados = await ctx.http().get('/appointments?status=AGENDADO').expect(200);

      expect(cancelados.body.meta.total).toBe(1);
      expect(agendados.body.meta.total).toBe(7);
    });

    it('usa página 1 e limite 20 por padrão', async () => {
      const res = await ctx.http().get('/appointments').expect(200);

      expect(res.body.meta).toMatchObject({ total: 8, page: 1, limit: 20, totalPages: 1 });
    });

    it('400 para parâmetros inválidos', async () => {
      await ctx.http().get('/appointments?limit=1000').expect(400);
      await ctx.http().get('/appointments?page=0').expect(400);
      await ctx.http().get('/appointments?date=2030-13-45').expect(400);
      await ctx.http().get('/appointments?status=XYZ').expect(400);
    });
  });
});
