# Guia de estudo: Agenda API (para o Kaylan)

Este arquivo é para você estudar antes da entrevista. Não é para o recrutador. Leia o código junto, na ordem abaixo.

## 1. A ideia do NestJS em 5 linhas

- O Nest organiza o app em **módulos**. Cada módulo agrupa um assunto (agendamentos, relatórios...).
- Uma requisição entra num **controller** (cuida só de HTTP: rota, parâmetros, status).
- O controller chama um **service** (cuida da regra de negócio).
- O service usa o **PrismaService** para falar com o banco.
- Quem monta tudo (cria os objetos e entrega um ao outro) é o Nest, pela **injeção de dependência**.

Fluxo de um `POST /appointments`:

```
requisição -> ValidationPipe (valida o DTO) -> AppointmentsController -> AppointmentsService
           -> PrismaService (transação) -> Postgres -> resposta JSON
(se algo lançar erro) -> AllExceptionsFilter -> JSON de erro padronizado
```

## 2. Arquivo por arquivo

### Raiz

- `package.json`: scripts (`npm test`, `npm run test:e2e`, `npm run build`...) e dependências. O `prisma` está em `dependencies` porque a imagem Docker roda `prisma migrate deploy` ao subir.
- `nest-cli.json`: configuração do Nest CLI. O plugin `@nestjs/swagger` lê os DTOs e monta a documentação em `/docs` sozinho.
- `tsconfig.json`: TypeScript em modo `strict` (não deixa `any` implícito nem `null` passar sem tratar). `tsconfig.build.json` compila só `src/`.
- `eslint.config.mjs` e `.prettierrc`: padrão de código (lint acha problemas, prettier formata).
- `docker-compose.yml`: três serviços: `db` (Postgres de desenvolvimento), `api` (a aplicação) e `db-test` (Postgres descartável dos testes, só sobe com `--profile test`).
- `Dockerfile`: multi-stage. O estágio `build` instala tudo e compila; o estágio `runtime` leva só dependências de produção e o `dist/`. Resultado: imagem menor e sem ferramentas de desenvolvimento.
- `.github/workflows/ci.yml`: a cada push roda lint, build, testes unitários, e2e (com um Postgres como `service` do GitHub) e o build do Docker.

### `prisma/`

- `schema.prisma`: o modelo de dados. Tem 4 tabelas (`Professional`, `Service`, `Client`, `Appointment`) e o enum `AppointmentStatus`. `Appointment` tem as chaves estrangeiras para as três outras (isso é o "relacionamento"), e um `@@index([professionalId, startsAt])` para a busca de conflito ser rápida.
- `migrations/`: o SQL gerado pelo Prisma a partir do schema. É o histórico versionado do banco. `prisma migrate dev` cria; `prisma migrate deploy` só aplica (usado em produção, CI e testes).
- `seed.ts`: apaga tudo e recria uma barbearia de exemplo (`TRUNCATE ... RESTART IDENTITY`).

### `src/main.ts` e `src/setup-app.ts`

- `main.ts` é a porta de entrada: cria o app, aplica a configuração, monta o Swagger e escuta na porta.
- `setup-app.ts` tem o `configureApp()`: registra o `ValidationPipe` e o filtro global. Foi separado para os testes e2e usarem **exatamente a mesma configuração**.

`ValidationPipe` com três opções:
- `whitelist: true`: campos que não estão no DTO são descartados.
- `forbidNonWhitelisted: true`: em vez de descartar, devolve 400 dizendo que o campo não deveria existir.
- `transform: true`: converte o JSON/query string para a classe do DTO (por exemplo `"2"` vira `2`, ISO string vira `Date`).

### `src/app.module.ts`

O módulo raiz. Só importa os outros módulos e configura o `ConfigModule` (lê o `.env` e falha logo no início se faltar `DATABASE_URL`).

### `src/prisma/`

- `prisma.service.ts`: uma classe que **estende o `PrismaClient`**. Assim, onde você injetar `PrismaService`, tem `this.prisma.appointment.findMany(...)`. Implementa `OnModuleInit` (conecta ao banco quando o app sobe) e `OnModuleDestroy` (desconecta ao fechar).
- `prisma.module.ts`: marcado com `@Global()`, então todos os módulos podem injetar o `PrismaService` sem precisar importar este módulo toda hora.

### Cada módulo de cadastro (`professionals/`, `services/`, `clients/`)

Todos têm a mesma estrutura:
- `*.module.ts`: lista o controller e o service daquele módulo.
- `*.controller.ts`: decorators `@Controller('professionals')`, `@Get()`, `@Post()`, `@Param`, `@Body`. O `ParseIntPipe` converte o `:id` da URL em número (e dá 400 se vier "abc").
- `*.service.ts`: chama o Prisma. Note que `update` e `remove` não verificam se o registro existe: se não existir, o Prisma lança o erro `P2025` e o filtro global transforma em 404. Isso evita uma consulta a mais.
- `dto/*.dto.ts`: classes com decorators do class-validator (`@IsString`, `@IsInt`, `@Min`...). O DTO de atualização usa `PartialType(CreateDto)`, que copia as regras e torna todos os campos opcionais.

O módulo `services` se chama assim porque o domínio tem "serviços oferecidos" (corte, barba). Não confunda com o "service" do Nest (a classe de regra de negócio).

### `src/appointments/` (o coração do projeto)

- `appointment-rules.ts`: funções puras, sem Nest e sem banco: `calculateEnd` (fim = início + duração), o mapa `ALLOWED_TRANSITIONS` (máquina de estados) e `canTransition`. Por serem puras, são fáceis de testar.
- `dto/create-appointment.dto.ts`: `@Type(() => Date) @IsDate()` converte a string ISO em `Date` e rejeita data inválida.
- `dto/list-appointments-query.dto.ts`: filtros da listagem. Herda de `PaginationQueryDto`. Query string chega sempre como texto, por isso o `@Type(() => Number)`.
- `appointments.service.ts`:
  - `create`: (1) rejeita passado (422); (2) busca serviço e cliente (404 se não existirem); (3) calcula o fim; (4) abre a **transação**: trava o profissional, procura sobreposição, insere. Se achar sobreposição lança `ConflictException` (409); lançar uma exceção dentro de `$transaction` faz **rollback** automático.
  - `findAll`: monta o `where` com os filtros; `$transaction([findMany, count])` executa a lista e o total juntos; `skip/take` fazem a paginação.
  - `updateStatus`: confere `canTransition`; atualiza com `updateMany({ where: { id, status: statusAtual } })`. Se `count` vier 0, outra requisição mudou o status antes, e devolve 409.
  - `include: { client, service, professional }` é o "join" do Prisma: traz os objetos relacionados na mesma resposta.
- `appointments.controller.ts`: 4 rotas. A rota é `PATCH /appointments/:id/status`.

### A transação, em português simples

Problema: duas pessoas tentam o mesmo horário no mesmo milissegundo. As duas perguntam "está livre?", as duas ouvem "sim", as duas inserem. Resultado: horário duplicado.

Solução usada: dentro da transação, `SELECT id FROM "Professional" WHERE id = X FOR UPDATE`. Isso **trava a linha daquele profissional** até a transação terminar. A segunda requisição fica esperando; quando a primeira termina (commit), a segunda destrava, pergunta "está livre?" e agora ouve "não" (409). Profissionais diferentes têm linhas diferentes, então não se atrapalham.

Alternativa que você pode citar: constraint `EXCLUDE USING gist` com `tstzrange` no Postgres, que faz o próprio banco recusar sobreposição. É mais forte, porém mais difícil de ler e de mapear o erro; está listada como evolução no README.

### `src/reports/`

- `reports.service.ts`: duas consultas com `$queryRaw` (SQL escrito à mão): faturamento (`JOIN` + `GROUP BY` + `SUM`) e ocupação (`LEFT JOIN`). `${start}` dentro do template é **parametrizado** (seguro contra SQL injection). `::int` converte `bigint` para número, porque `BigInt` não vira JSON. `resolvePeriod` trata o período e é testada à parte.
- Por que SQL à mão? Agregação com JOIN e GROUP BY fica mais clara em SQL, e a vaga cita "consultas, joins, relacionamentos".

### `src/common/`

- `all-exceptions.filter.ts`: `@Catch()` sem argumentos pega **qualquer** erro. Decide o status (HttpException mantém o dela; erro do Prisma passa por `mapPrismaError`; o resto vira 500) e responde sempre `{ statusCode, error, message, path, timestamp }`.
- `prisma-error.ts`: o mapeamento `P2002 -> 409`, `P2025 -> 404`, `P2003 -> 409`.
- `pagination.ts`: DTO de `page/limit` (padrão 1 e 20, máximo 100) e a função que monta `{ data, meta: { total, page, limit, totalPages } }`.

### `src/health/`

`GET /health` faz `SELECT 1`. Se o banco cair devolve 503. Docker/Kubernetes usam rotas assim para saber se o container está saudável.

### Testes

**Unitários (`src/**/*.spec.ts`)**
- Rodam sem banco. O `PrismaService` é trocado por um objeto falso (mock) no `Test.createTestingModule({ providers: [{ provide: PrismaService, useValue: prisma }] })`. Isso só funciona por causa da injeção de dependência: o service pede um `PrismaService` e o teste entrega outro.
- O mock de `$transaction` executa o callback passando o próprio mock, então dá para testar a regra de sobreposição sem Postgres.
- Testam: cálculo do fim, passado, sobreposição (e se a consulta usa os filtros certos), 404s, máquina de estados, filtro de exceções.

**e2e (`test/*.e2e-spec.ts`)**
- Sobem o app inteiro (`AppModule`) e fazem requisições HTTP de verdade com Supertest contra o Postgres de teste (porta 5433).
- `global-setup.ts` aplica as migrations; `set-env.ts` força o `DATABASE_URL` do teste (nunca toca no banco de desenvolvimento); `helpers.ts` tem `createTestApp`, `resetDatabase` (TRUNCATE antes de cada teste) e fábricas de dados.
- `--runInBand` roda um arquivo por vez, porque todos usam o mesmo banco.
- O teste de requisições simultâneas é o mais importante: ele prova que a trava funciona (testei removendo o `FOR UPDATE` e o teste falhou).

Diferença para dizer na entrevista: unitário testa **a regra isolada, rápido**; e2e testa **o conjunto funcionando de verdade**, com banco, validação e filtro de erro.

## 3. Comandos úteis

```bash
npm run start:dev                 # sobe com reload
npm test                          # unitários
docker compose --profile test up -d db-test && npm run test:e2e
npx prisma migrate dev --name x   # cria migration após mudar o schema
npx prisma studio                 # interface visual do banco
```

## 4. Dez perguntas de entrevista

**1. Como você impede dois agendamentos no mesmo horário para o mesmo profissional?**
Dentro de uma `$transaction` eu trava a linha do profissional com `SELECT ... FOR UPDATE`, depois verifico se há agendamento ativo sobreposto e só então insiro. Requisições concorrentes ficam em fila para o mesmo profissional, então a segunda sempre vê o que a primeira gravou e recebe 409.

**2. Como você define "sobreposição"?**
Dois intervalos se sobrepõem quando `inicioA < fimB` e `fimA > inicioB`. Como usei `<` e `>` (sem igual), horários colados não conflitam: 14:00-14:30 e 14:30-15:00 são válidos.

**3. Por que guardar preço em centavos?**
Ponto flutuante não representa decimais exatamente (`0.1 + 0.2 != 0.3`), e em dinheiro isso vira erro de centavo. Inteiros somam exato. Também gravo o preço no agendamento no momento da marcação para o histórico não mudar se o preço do serviço mudar.

**4. O que é injeção de dependência e como o Nest faz?**
Em vez de a classe criar suas dependências (`new PrismaService()`), ela as declara no construtor e o contêiner do Nest entrega a instância. Isso reduz acoplamento e permite trocar por um mock nos testes. O Nest sabe o que entregar porque a classe está em `providers` de um módulo e tem `@Injectable()`.

**5. Qual a diferença entre controller, service e módulo?**
Controller recebe a requisição HTTP e devolve a resposta; service tem a regra de negócio e acesso a dados; módulo agrupa controllers e providers de um assunto e define o que é exportado para outros módulos.

**6. O que o `ValidationPipe` faz e o que significam `whitelist` e `forbidNonWhitelisted`?**
Valida o corpo/query contra as regras do DTO (class-validator) antes de chegar no controller. `whitelist` remove campos desconhecidos; `forbidNonWhitelisted` rejeita a requisição com 400 se houver campos desconhecidos; `transform` converte tipos.

**7. Como os erros do Prisma viram respostas HTTP?**
Um exception filter global (`@Catch()`) intercepta tudo. Para `PrismaClientKnownRequestError` ele usa o `code`: P2002 (violação de unique) vira 409, P2025 (registro não encontrado) vira 404, P2003 (chave estrangeira) vira 409. O formato do JSON é sempre o mesmo.

**8. Por que usar `$queryRaw` no relatório se há o Prisma Client?**
Porque uma agregação com JOIN e GROUP BY (somar faturamento por profissional) fica mais clara e eficiente em SQL. Uso o template tag do Prisma, que parametriza os valores e evita SQL injection. Ainda tipo o retorno e converto `bigint` para `int`.

**9. Como funciona a máquina de estados e como evitar que duas mudanças simultâneas se atropelem?**
Um mapa define para quais estados cada um pode ir (concluído e cancelado são finais); o service consulta antes de alterar e responde 422 se for inválido. Na atualização uso `updateMany` com `where: { id, status: statusAtual }`: se outra requisição mudou o status antes, nenhum registro é afetado e eu devolvo 409.

**10. Como você testou isso e o que cada tipo de teste garante?**
Unitários com Prisma mockado validam as regras do service rápido e isolado (fim calculado, passado, sobreposição, transições). Os e2e sobem o app com Postgres real e validam o fluxo completo: validação, banco, transação, filtro de erro, relatórios. Um e2e dispara 8 requisições simultâneas para o mesmo horário e exige exatamente 1 criação, o que prova a proteção contra condição de corrida.

### Bônus (podem perguntar)

- **Por que 422 e não 400 para transição inválida?** 400 é requisição malformada; aqui o JSON é válido, mas viola uma regra de negócio. 422 (ou 409) comunica isso melhor.
- **O que você faria para escalar?** Constraint `EXCLUDE` no banco como segunda linha de defesa, cache em listagens, índices adequados (já existe `[professionalId, startsAt]`), paginação por cursor se a lista crescer muito.
- **O que falta para produção?** Autenticação (JWT), multi-tenant, rate limit, logs estruturados, métricas, horário de funcionamento do profissional.
- **O que é `prisma migrate deploy` vs `dev`?** `dev` cria migrations a partir do schema e pode resetar o banco; `deploy` só aplica as já existentes, seguro para produção/CI.
