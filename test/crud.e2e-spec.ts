import { createScenario, createTestApp, futureDate, resetDatabase, TestContext } from './helpers';

describe('Cadastros, erros e health (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('GET /health responde ok com o banco de pé', async () => {
    const res = await ctx.http().get('/health').expect(200);

    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  describe('profissionais', () => {
    it('cria, lista, busca, atualiza e remove', async () => {
      const created = await ctx.http().post('/professionals').send({ name: 'Thor' }).expect(201);
      const id = created.body.id;

      const list = await ctx.http().get('/professionals').expect(200);
      expect(list.body).toHaveLength(1);

      await ctx.http().get(`/professionals/${id}`).expect(200);
      const updated = await ctx
        .http()
        .patch(`/professionals/${id}`)
        .send({ name: 'Thor A.' })
        .expect(200);
      expect(updated.body.name).toBe('Thor A.');

      await ctx.http().delete(`/professionals/${id}`).expect(204);
      await ctx.http().get(`/professionals/${id}`).expect(404);
    });

    it('404 (P2025 do Prisma) ao atualizar ou remover id inexistente', async () => {
      const upd = await ctx.http().patch('/professionals/9999').send({ name: 'X' }).expect(404);
      await ctx.http().delete('/professionals/9999').expect(404);

      expect(upd.body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        path: '/professionals/9999',
      });
      expect(typeof upd.body.timestamp).toBe('string');
    });

    it('409 (P2003) ao remover profissional que já tem agendamentos', async () => {
      const s = await createScenario(ctx.prisma);
      await ctx
        .http()
        .post('/appointments')
        .send({
          professionalId: s.professionalId,
          serviceId: s.serviceId,
          clientId: s.clientId,
          startsAt: futureDate(2, 9).toISOString(),
        })
        .expect(201);

      await ctx.http().delete(`/professionals/${s.professionalId}`).expect(409);
    });

    it('400 para nome vazio e para campos fora do DTO', async () => {
      await ctx.http().post('/professionals').send({ name: '' }).expect(400);
      await ctx.http().post('/professionals').send({ name: 'Ok', admin: true }).expect(400);
    });
  });

  describe('serviços', () => {
    it('guarda preço em centavos e valida os limites', async () => {
      const ok = await ctx
        .http()
        .post('/services')
        .send({ name: 'Barba', durationMinutes: 30, priceCents: 3500 })
        .expect(201);
      expect(ok.body.priceCents).toBe(3500);

      await ctx
        .http()
        .post('/services')
        .send({ name: 'X', durationMinutes: 30, priceCents: 35.5 })
        .expect(400);
      await ctx
        .http()
        .post('/services')
        .send({ name: 'X', durationMinutes: 1, priceCents: 100 })
        .expect(400);
      await ctx
        .http()
        .post('/services')
        .send({ name: 'X', durationMinutes: 30, priceCents: -1 })
        .expect(400);
    });
  });

  describe('clientes', () => {
    it('409 (P2002 do Prisma) para e-mail duplicado', async () => {
      const body = { name: 'Lucas', email: 'lucas@example.com' };
      await ctx.http().post('/clients').send(body).expect(201);

      const res = await ctx.http().post('/clients').send(body).expect(409);

      expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict' });
      expect(res.body.message).toMatch(/email/);
    });

    it('400 para e-mail inválido e lista paginada', async () => {
      await ctx.http().post('/clients').send({ name: 'A', email: 'nao-e-email' }).expect(400);

      for (const n of [1, 2, 3]) {
        await ctx
          .http()
          .post('/clients')
          .send({ name: `Cliente ${n}`, email: `c${n}@example.com` })
          .expect(201);
      }
      const res = await ctx.http().get('/clients?page=2&limit=2').expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toEqual({ total: 3, page: 2, limit: 2, totalPages: 2 });
    });
  });
});
