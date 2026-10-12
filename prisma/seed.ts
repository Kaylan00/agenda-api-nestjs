/**
 * Dados de exemplo: uma barbearia com 3 profissionais, 5 serviços e 6 clientes.
 * Rode com: npm run prisma:seed   (apaga os dados existentes e recria tudo)
 */
import { AppointmentStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Hoje às `hour` horas (UTC), deslocado em `days` dias. */
function at(days: number, hour: number): Date {
  const base = new Date();
  base.setUTCHours(hour, 0, 0, 0);
  return new Date(base.getTime() + days * DAY);
}

async function main(): Promise<void> {
  await prisma.$executeRaw`
    TRUNCATE TABLE "Appointment", "Client", "Service", "Professional" RESTART IDENTITY CASCADE`;

  const [thor, bruna, caio] = await Promise.all(
    ['Thor Almeida', 'Bruna Costa', 'Caio Ribeiro'].map((name) =>
      prisma.professional.create({ data: { name } }),
    ),
  );

  const [corte, barba, combo, sobrancelha, hidratacao] = [
    await prisma.service.create({
      data: { name: 'Corte masculino', durationMinutes: 30, priceCents: 4500 },
    }),
    await prisma.service.create({
      data: { name: 'Barba', durationMinutes: 30, priceCents: 3500 },
    }),
    await prisma.service.create({
      data: { name: 'Corte + Barba', durationMinutes: 60, priceCents: 7500 },
    }),
    await prisma.service.create({
      data: { name: 'Sobrancelha', durationMinutes: 15, priceCents: 2000 },
    }),
    await prisma.service.create({
      data: { name: 'Hidratação', durationMinutes: 45, priceCents: 6000 },
    }),
  ];

  const clientData: [name: string, email: string, phone: string | null][] = [
    ['Lucas Martins', 'lucas@example.com', '27999990001'],
    ['Rafael Souza', 'rafael@example.com', '27999990002'],
    ['Marcos Pereira', 'marcos@example.com', '27999990003'],
    ['João Vitor', 'joao@example.com', '27999990004'],
    ['Pedro Henrique', 'pedro@example.com', null],
    ['Felipe Andrade', 'felipe@example.com', '27999990006'],
  ];
  const clients = await Promise.all(
    clientData.map(([name, email, phone]) =>
      prisma.client.create({ data: { name, email, phone } }),
    ),
  );

  type Seed = [
    professionalId: number,
    serviceId: number,
    clientIndex: number,
    startsAt: Date,
    status: AppointmentStatus,
    durationMinutes: number,
    priceCents: number,
  ];

  const rows: Seed[] = [
    // Atendimentos já concluídos (alimentam o relatório de faturamento)
    [thor.id, corte.id, 0, at(-3, 13), 'CONCLUIDO', 30, 4500],
    [thor.id, combo.id, 1, at(-3, 14), 'CONCLUIDO', 60, 7500],
    [bruna.id, hidratacao.id, 2, at(-2, 15), 'CONCLUIDO', 45, 6000],
    [bruna.id, corte.id, 3, at(-2, 16), 'CONCLUIDO', 30, 4500],
    [caio.id, barba.id, 4, at(-1, 13), 'CONCLUIDO', 30, 3500],
    [caio.id, sobrancelha.id, 5, at(-1, 14), 'CONCLUIDO', 15, 2000],
    [thor.id, barba.id, 2, at(-1, 17), 'CANCELADO', 30, 3500],
    // Próximos agendamentos
    [thor.id, corte.id, 0, at(1, 13), 'AGENDADO', 30, 4500],
    [thor.id, combo.id, 3, at(1, 15), 'CONFIRMADO', 60, 7500],
    [bruna.id, corte.id, 1, at(1, 13), 'AGENDADO', 30, 4500],
    [bruna.id, hidratacao.id, 4, at(2, 14), 'CONFIRMADO', 45, 6000],
    [caio.id, combo.id, 5, at(2, 16), 'AGENDADO', 60, 7500],
  ];

  for (const [
    professionalId,
    serviceId,
    clientIndex,
    startsAt,
    status,
    minutes,
    priceCents,
  ] of rows) {
    await prisma.appointment.create({
      data: {
        professionalId,
        serviceId,
        clientId: clients[clientIndex].id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + minutes * 60_000),
        status,
        priceCents,
      },
    });
  }

  console.log(`Seed concluído: ${rows.length} agendamentos, ${clients.length} clientes.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
