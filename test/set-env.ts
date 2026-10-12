import { TEST_DATABASE_URL } from './test-db';

// Roda antes de cada arquivo de teste: faz o app (e o Prisma) apontarem para o banco de teste,
// nunca para o de desenvolvimento.
process.env.DATABASE_URL = TEST_DATABASE_URL;
