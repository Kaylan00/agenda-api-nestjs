import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-db';

/** Antes de todos os testes: aplica as migrations no banco de teste. */
export default function globalSetup(): void {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
