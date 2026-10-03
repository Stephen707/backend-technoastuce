import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';
import ts from 'typescript';

// Path aliases (e.g. the ones added by `nest g library`) live in tsconfig.json,
// so they are read from there instead of being duplicated here.
const { config: tsconfig } = ts.readConfigFile(
  './tsconfig.json',
  ts.sys.readFile,
);
const paths = tsconfig?.compilerOptions?.paths ?? {};

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    // NestJS 12 ships ESM only, which Jest can't require() before Node 24.9:
    // those packages are compiled to CommonJS for tests (see transformer).
    // So are htmlparser2 and its dom*/entities deps (used by sanitize-html).
    '^.+\\.js$': '<rootDir>/test/esm-to-cjs.transformer.cjs',
  },
  transformIgnorePatterns: [
    'node_modules[\\\\/](?!(?:@nestjs|htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities)[\\\\/])',
  ],
  moduleNameMapper: pathsToModuleNameMapper(paths, { prefix: '<rootDir>/' }),
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    'libs/**/*.(t|j)s',
    'apps/**/*.(t|j)s',
  ],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};

export default config;
