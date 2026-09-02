// Entry shim so that `node --test test/` works on Node >= 21, where the test
// runner treats positional arguments as glob patterns and no longer expands a
// bare directory. Node resolves the directory to this file; it then loads every
// suite in-process. When the runner discovers this file itself (bare
// `node --test`, which already matches test/*.test.js), it does nothing so the
// suites are not executed twice.
import path from 'node:path';

const invokedAsDirectory = path.basename(process.argv[1] ?? '') !== 'index.js';

if (invokedAsDirectory) {
  await import('./core.test.js');
  await import('./cli.test.js');
  await import('./data.test.js');
}
