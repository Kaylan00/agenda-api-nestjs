import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppointmentsModule } from './appointments/appointments.module';
import { ClientsModule } from './clients/clients.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfessionalsModule } from './professionals/professionals.module';
import { ReportsModule } from './reports/reports.module';
import { ServicesModule } from './services/services.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (env: Record<string, unknown>) => {
        if (!env.DATABASE_URL) {
          throw new Error('Variável de ambiente DATABASE_URL não definida (veja .env.example)');
        }
        return env;
      },
    }),
    PrismaModule,
    ProfessionalsModule,
    ServicesModule,
    ClientsModule,
    AppointmentsModule,
    ReportsModule,
    HealthModule,
  ],
})
export class AppModule {}
