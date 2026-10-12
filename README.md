# Agenda API

API REST de agendamentos para negócios de serviço (barbearias, clínicas, estúdios): cadastro de profissionais, serviços e clientes, marcação de horários sem conflito e relatórios de faturamento e ocupação.

Feita com **NestJS 11, TypeScript (strict), Prisma 6 e PostgreSQL 16**, com testes unitários (Jest), testes e2e contra Postgres real (Supertest), Docker e CI no GitHub Actions.

## Por que este projeto existe

O domínio vem de um produto real que desenvolvo, o **Encaixaê**, um SaaS de agendamento para pequenos negócios. A parte difícil desse tipo de sistema é a mesma em qualquer plataforma que tenha um módulo de agendamento (como o de plataformas de gestão tipo Hub): **dois clientes não podem ocupar o mesmo profissional no mesmo horário**, mesmo quando as requisições chegam ao mesmo tempo, e o ciclo de vida do agendamento precisa de regras claras.

Este repositório isola esse núcleo em uma API pequena e bem testada, usando a stack de back-end com Nest, Postgres e Prisma.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Framework | NestJS 11, TypeScript em modo `strict` |
| Banco | PostgreSQL 16 |
| ORM | Prisma 6 (migrations versionadas, `$transaction`, `$queryRaw`) |
| Validação | class-validator + class-transformer (`ValidationPipe` global com `whitelist`, `forbidNonWhitelisted` e `transform`) |
| Documentação | Swagger em `/docs` |
| Testes | Jest (unitários, Prisma mockado) e Jest + Supertest (e2e, Postgres real) |
| Infra | Docker Compose, Dockerfile multi-stage, GitHub Actions |

## Como rodar

### Tudo em Docker

```bash
docker compose up --build
```

Sobe o Postgres e a API (as migrations são aplicadas na inicialização). A API fica em `http://localhost:3000` e a documentação em `http://localhost:3000/docs`.

Para popular com dados de exemplo (uma barbearia com 3 profissionais, 5 serviços, 6 clientes e 12 agendamentos):

```bash
cp .env.example .env
npm ci
npm run prisma:seed
```

### Desenvolvimento local

```bash
cp .env.example .env
docker compose up -d db        # só o Postgres
npm ci
npm run prisma:deploy          # aplica as migrations
npm run prisma:seed            # opcional
npm run start:dev
```

Requer Node 20+.

## Endpoints principais

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/appointments` | Cria agendamento (`professionalId`, `serviceId`, `clientId`, `startsAt`). O fim é calculado pela duração do serviço |
| GET | `/appointments` | Lista com filtros `professionalId`, `date` (AAAA-MM-DD), `status` e paginação `page`/`limit` |
| GET | `/appointments/:id` | Detalhe com cliente, serviço e profissional |
| PATCH | `/appointments/:id/status` | Muda o status (`CONFIRMADO`, `CONCLUIDO`, `CANCELADO`) |
| GET | `/reports/faturamento?from&to` | Faturamento dos atendimentos concluídos, por profissional e por serviço |
| GET | `/reports/ocupacao?from&to` | Minutos reservados por profissional |
| CRUD | `/professionals`, `/services`, `/clients` | Cadastros básicos (clientes com paginação) |
| GET | `/health` | Status da API e do banco |

Exemplo:

```bash
curl -X POST localhost:3000/appointments \
  -H 'content-type: application/json' \
  -d '{"professionalId":1,"serviceId":3,"clientId":1,"startsAt":"2026-11-10T14:00:00.000Z"}'
```

Todos os erros saem no mesmo formato:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "O profissional já possui um agendamento nesse horário",
  "path": "/appointments",
  "timestamp": "2026-10-12T22:39:43.196Z"
}
```

Códigos usados: `400` payload/parâmetro inválido, `404` não encontrado, `409` conflito (horário ocupado, e-mail duplicado, registro em uso), `422` regra de negócio violada (horário no passado, transição de status inválida).

## Regras do agendamento

- Não é possível agendar no passado.
- O fim é `início + duração do serviço`.
- Um profissional não pode ter dois agendamentos **ativos** (`AGENDADO` ou `CONFIRMADO`) com horários sobrepostos. Horários colados (um termina às 14:30 e outro começa às 14:30) são permitidos.
- Cancelar libera o horário.
- Datas são tratadas em UTC (o filtro `date` considera o dia UTC).

Máquina de estados:

```
AGENDADO --> CONFIRMADO --> CONCLUIDO
    |            |
    +------------+------> CANCELADO
```

`CONCLUIDO` e `CANCELADO` são finais; qualquer outra transição devolve 422.

## Decisões técnicas

**Transação com trava para evitar conflito de horário.** Verificar "existe agendamento sobreposto?" e depois inserir são dois passos; se duas requisições simultâneas passarem pela verificação antes de qualquer uma inserir, os dois horários seriam criados. A criação roda em `prisma.$transaction` e começa com `SELECT ... FOR UPDATE` na linha do profissional: requisições para o mesmo profissional entram em fila, e cada uma já enxerga o que a anterior gravou. Profissionais diferentes não se bloqueiam. Há um teste e2e que dispara 8 requisições simultâneas pelo mesmo horário e confirma que exatamente uma é criada (sem o `FOR UPDATE`, esse teste falha).

**Preço em centavos (`Int`).** Dinheiro em ponto flutuante gera erros de arredondamento (`0.1 + 0.2`). Guardar centavos inteiros deixa somas exatas; a formatação em reais fica para o cliente da API. O agendamento também grava `priceCents` no momento da marcação, para que alterar o preço do serviço depois não mude o histórico nem os relatórios.

**Máquina de estados em um mapa.** As transições permitidas ficam em uma tabela (`ALLOWED_TRANSITIONS` em `appointment-rules.ts`), e `canTransition` é uma função pura, fácil de testar. A atualização usa `updateMany` com `where: { id, status: statusAtual }`, o que impede que duas mudanças simultâneas se sobrescrevam.

**SQL explícito nos relatórios.** O faturamento usa `$queryRaw` com `JOIN` e `GROUP BY`, que expressa a agregação melhor que várias chamadas do ORM:

```sql
SELECT p.id AS "professionalId", p.name,
       COUNT(a.id)::int AS appointments,
       COALESCE(SUM(a."priceCents"), 0)::int AS "revenueCents"
FROM "Appointment" a
JOIN "Professional" p ON p.id = a."professionalId"
WHERE a.status = 'CONCLUIDO'
  AND a."startsAt" >= ${start} AND a."startsAt" < ${end}
GROUP BY p.id, p.name
ORDER BY "revenueCents" DESC, p.name
```

Os valores entram como parâmetros (template tag do Prisma), sem concatenação de string, então não há SQL injection. O `::int` converte o `bigint` do Postgres, que o JSON não suporta. A ocupação usa `LEFT JOIN` para listar também profissionais sem atendimentos.

**Erros do Prisma viram erros HTTP.** Um filtro global (`AllExceptionsFilter`) mapeia `P2002` (unique) para 409, `P2025` (não encontrado) para 404 e `P2003` (chave estrangeira) para 409, mantendo um formato único de resposta. Exceções desconhecidas viram 500 sem vazar detalhes internos.

**Mesma configuração em produção e nos testes.** `configureApp()` (pipes e filtro) é usada tanto pelo `main.ts` quanto pelos testes e2e, então os testes exercitam o app como ele roda de verdade.

## Testes

```bash
npm test                         # unitários (40), não precisam de banco
docker compose --profile test up -d db-test
npm run test:e2e                 # e2e (35), contra Postgres real na porta 5433
npm run lint
npm run build
```

- **Unitários:** regras do `AppointmentsService` com Prisma mockado (cálculo do fim, passado, sobreposição, máquina de estados, `404`s), tabela de transições, filtro de exceções e período dos relatórios.
- **e2e:** subem o app completo contra um Postgres de teste (migrations aplicadas automaticamente): criar agendamento, conflito 409 (inclusive sobreposição parcial, englobamento e requisições simultâneas), cancelar e liberar horário, transições inválidas, filtros com paginação, relatórios, validação e mapeamento de erros do Prisma.

Em CI (`.github/workflows/ci.yml`) o pipeline roda lint, build, testes unitários, e2e com um serviço Postgres e o build da imagem Docker.

## Estrutura

```
prisma/            schema, migrations e seed
src/
  appointments/    agendamentos: regras, service, controller, DTOs
  reports/         relatórios com SQL explícito
  professionals/ services/ clients/   cadastros
  health/          health check
  common/          filtro de exceções, mapeamento de erros do Prisma, paginação
  prisma/          PrismaService (módulo global)
test/              testes e2e e helpers
```

## Possíveis evoluções

Autenticação e multi-tenant (um negócio por conta), horário de funcionamento e folgas do profissional, reagendamento, notificações por e-mail e restrição de sobreposição também no banco (constraint `EXCLUDE` com `tstzrange`).
