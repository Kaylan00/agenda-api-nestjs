/** Banco usado nos testes e2e. Em CI vem de TEST_DATABASE_URL; localmente, do docker compose (porta 5433). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://agenda:agenda@localhost:5433/agenda_test?schema=public';
