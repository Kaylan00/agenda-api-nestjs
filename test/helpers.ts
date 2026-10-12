import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup-app';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
}

/** Sobe o app inteiro (mesma configuração do main.ts) contra o Postgres de teste. */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), http: () => request(app.getHttpServer()) };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRaw`
    TRUNCATE TABLE "Appointment", "Client", "Service", "Professional" RESTART IDENTITY CASCADE`;
}

/** Data futura (UTC): daqui a `days` dias, às `hour` horas e `minute` minutos. */
export function futureDate(days: number, hour: number, minute = 0): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
}

export interface Scenario {
  professionalId: number;
  otherProfessionalId: number;
  serviceId: number; // 30 min, R$ 45,00
  longServiceId: number; // 60 min, R$ 75,00
  clientId: number;
}

/** Cria dois profissionais, dois serviços e um cliente direto pelo Prisma. */
export async function createScenario(prisma: PrismaService): Promise<Scenario> {
  const professional = await prisma.professional.create({ data: { name: 'Thor' } });
  const other = await prisma.professional.create({ data: { name: 'Bruna' } });
  const service = await prisma.service.create({
    data: { name: 'Corte', durationMinutes: 30, priceCents: 4500 },
  });
  const longService = await prisma.service.create({
    data: { name: 'Corte + Barba', durationMinutes: 60, priceCents: 7500 },
  });
  const client = await prisma.client.create({
    data: { name: 'Lucas', email: 'lucas@example.com' },
  });
  return {
    professionalId: professional.id,
    otherProfessionalId: other.id,
    serviceId: service.id,
    longServiceId: longService.id,
    clientId: client.id,
  };
}
