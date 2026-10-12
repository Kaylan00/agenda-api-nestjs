import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

/** Configuração compartilhada entre main.ts e os testes e2e (assim o teste roda o app "de verdade"). */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove campos que não estão no DTO
      forbidNonWhitelisted: true, // e devolve 400 se vierem campos extras
      transform: true, // converte payload/query para as classes dos DTOs (e "1" para 1)
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
