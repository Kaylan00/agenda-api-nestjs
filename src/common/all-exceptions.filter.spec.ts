import { ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('erro do prisma', {
    code,
    clientVersion: 'test',
    meta,
  });
}

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'GET', url: '/teste' }),
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);

  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  beforeEach(() => {
    // silencia o log de erro 500 para não poluir a saída dos testes
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('P2002 vira 409 citando o campo', () => {
    const { status, body } = run(prismaError('P2002', { target: ['email'] }));

    expect(status).toBe(409);
    expect(body.message).toContain('email');
  });

  it('P2025 vira 404', () => {
    const { status, body } = run(prismaError('P2025'));

    expect(status).toBe(404);
    expect(body.error).toBe('Not Found');
  });

  it('P2003 vira 409', () => {
    expect(run(prismaError('P2003')).status).toBe(409);
  });

  it('mantém a lista de mensagens do ValidationPipe', () => {
    const { status, body } = run(new BadRequestException(['name must be a string', 'x inválido']));

    expect(status).toBe(400);
    expect(body.message).toEqual(['name must be a string', 'x inválido']);
  });

  it('HttpException comum mantém status e mensagem', () => {
    const { status, body } = run(new NotFoundException('Cliente 9 não encontrado'));

    expect(status).toBe(404);
    expect(body).toMatchObject({
      statusCode: 404,
      message: 'Cliente 9 não encontrado',
      path: '/teste',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('erro desconhecido vira 500 sem vazar detalhes', () => {
    const { status, body } = run(new Error('senha do banco: 123'));

    expect(status).toBe(500);
    expect(body.message).toBe('Erro interno do servidor');
  });

  it('código Prisma não mapeado vira 500', () => {
    expect(run(prismaError('P9999')).status).toBe(500);
  });
});
