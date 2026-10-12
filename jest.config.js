/** Testes unitários: arquivos *.spec.ts dentro de src/ (Prisma mockado). */
module.exports = {
  rootDir: 'src',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: ['**/*.ts', '!main.ts', '!**/*.module.ts', '!**/*.dto.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
