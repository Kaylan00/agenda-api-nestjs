import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface MappedError {
  statusCode: number;
  error: string;
  message: string;
}

/**
 * Traduz erros conhecidos do Prisma para respostas HTTP.
 * Retorna undefined quando o código não é tratado (vira 500 no filtro).
 */
export function mapPrismaError(
  error: Prisma.PrismaClientKnownRequestError,
): MappedError | undefined {
  switch (error.code) {
    case 'P2002': {
      // Violação de unique. meta.target traz os campos envolvidos.
      const target = error.meta?.target;
      const campos = Array.isArray(target) ? target.join(', ') : String(target ?? 'campo');
      return {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: `Já existe um registro com o mesmo valor de: ${campos}`,
      };
    }
    case 'P2025':
      // Registro não encontrado em update/delete.
      return {
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: 'Registro não encontrado',
      };
    case 'P2003':
      // Violação de chave estrangeira (ex.: apagar profissional que tem agendamentos).
      return {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'Operação bloqueada: o registro está relacionado a outros dados',
      };
    default:
      return undefined;
  }
}
