import { AppointmentStatus } from '@prisma/client';

/**
 * Máquina de estados do agendamento:
 *
 *   AGENDADO ──> CONFIRMADO ──> CONCLUIDO
 *       │            │
 *       └────────────┴──────> CANCELADO
 *
 * CONCLUIDO e CANCELADO são estados finais.
 */
export const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  AGENDADO: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['CONCLUIDO', 'CANCELADO'],
  CONCLUIDO: [],
  CANCELADO: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Só agendamentos ativos ocupam a agenda do profissional (cancelado/concluído não bloqueiam). */
export const ACTIVE_STATUSES: AppointmentStatus[] = ['AGENDADO', 'CONFIRMADO'];

/** Horário de término = início + duração do serviço. */
export function calculateEnd(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + durationMinutes * 60_000);
}
