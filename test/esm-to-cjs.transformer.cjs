// Jest transformer: NestJS 12 packages are ESM only, which Jest can't
// require() before Node 24.9. Compiles those files to CommonJS (tests only).
const ts = require('typescript');
const crypto = require('node:crypto');

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2023,
  esModuleInterop: true,
  sourceMap: false,
};

module.exports = {
  getCacheKey(sourceText, sourcePath) {
    return crypto
      .createHash('sha1')
      .update(ts.version)
      .update('\0')
      .update(sourcePath)
      .update('\0')
      .update(sourceText)
      .digest('hex');
  },
  process(sourceText, sourcePath) {
    let source = sourceText;
    // Some ESM files build their own `const require = createRequire(...)`,
    // which clashes with the CommonJS wrapper's `require`: rename it.
    if (/\b(?:const|let|var)\s+require\s*=/.test(source)) {
      source = source.replace(/\brequire\b/g, '__esmRequire');
    }
    // `import.meta` is a syntax error in CommonJS: use the CJS equivalent.
    source = source.replace(
      /\bimport\.meta\.url\b/g,
      "require('node:url').pathToFileURL(__filename).href",
    );
    const { outputText } = ts.transpileModule(source, {
      compilerOptions,
      fileName: sourcePath,
    });
    return { code: outputText };
  },
};
