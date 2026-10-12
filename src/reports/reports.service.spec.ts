import { BadRequestException } from '@nestjs/common';
import { resolvePeriod } from './reports.service';

describe('resolvePeriod', () => {
  it('inclui o dia inteiro quando "to" é só uma data', () => {
    const { start, end } = resolvePeriod({ from: '2030-01-01', to: '2030-01-31' });

    expect(start.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2030-02-01T00:00:00.000Z');
  });

  it('respeita o horário quando "to" é data e hora', () => {
    const { end } = resolvePeriod({ from: '2030-01-01', to: '2030-01-31T12:00:00.000Z' });

    expect(end.toISOString()).toBe('2030-01-31T12:00:00.000Z');
  });

  it('rejeita período invertido', () => {
    expect(() => resolvePeriod({ from: '2030-02-01', to: '2030-01-01' })).toThrow(
      BadRequestException,
    );
  });
});
