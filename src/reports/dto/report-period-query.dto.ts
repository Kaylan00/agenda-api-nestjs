import { IsISO8601 } from 'class-validator';

/** Período do relatório. Aceita data (2026-10-01) ou data e hora ISO. */
export class ReportPeriodQueryDto {
  /** Início, inclusivo. */
  @IsISO8601({ strict: true })
  from: string;

  /** Fim. Se vier só a data (2026-10-31), o dia inteiro é incluído. */
  @IsISO8601({ strict: true })
  to: string;
}
