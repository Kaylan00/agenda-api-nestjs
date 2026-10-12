import { AppointmentStatus } from '@prisma/client';
import { ALLOWED_TRANSITIONS, calculateEnd, canTransition } from './appointment-rules';

describe('appointment-rules', () => {
  describe('calculateEnd', () => {
    it('soma a duração do serviço ao início', () => {
      const start = new Date('2030-01-10T14:00:00.000Z');
      expect(calculateEnd(start, 45).toISOString()).toBe('2030-01-10T14:45:00.000Z');
    });

    it('atravessa a virada do dia', () => {
      const start = new Date('2030-01-10T23:30:00.000Z');
      expect(calculateEnd(start, 60).toISOString()).toBe('2030-01-11T00:30:00.000Z');
    });

    it('não altera a data original', () => {
      const start = new Date('2030-01-10T14:00:00.000Z');
      calculateEnd(start, 30);
      expect(start.toISOString()).toBe('2030-01-10T14:00:00.000Z');
    });
  });

  describe('canTransition', () => {
    it.each<[AppointmentStatus, AppointmentStatus]>([
      ['AGENDADO', 'CONFIRMADO'],
      ['AGENDADO', 'CANCELADO'],
      ['CONFIRMADO', 'CONCLUIDO'],
      ['CONFIRMADO', 'CANCELADO'],
    ])('permite %s -> %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });

    it.each<[AppointmentStatus, AppointmentStatus]>([
      ['AGENDADO', 'CONCLUIDO'], // precisa confirmar antes de concluir
      ['AGENDADO', 'AGENDADO'],
      ['CONFIRMADO', 'AGENDADO'],
      ['CONCLUIDO', 'CANCELADO'],
      ['CONCLUIDO', 'AGENDADO'],
      ['CANCELADO', 'AGENDADO'],
      ['CANCELADO', 'CONFIRMADO'],
    ])('bloqueia %s -> %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
    });

    it('estados finais não têm saída', () => {
      expect(ALLOWED_TRANSITIONS.CONCLUIDO).toEqual([]);
      expect(ALLOWED_TRANSITIONS.CANCELADO).toEqual([]);
    });
  });
});
