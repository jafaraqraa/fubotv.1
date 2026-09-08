const test = require('node:test');
const assert = require('node:assert/strict');

const scriptPath = require.resolve('../scripts/run-server-supervised.js');

const originalPort = process.env.PORT;

function withPort(value, fn) {
  if (value === undefined) delete process.env.PORT;
  else process.env.PORT = String(value);
  try {
    delete require.cache[scriptPath];
    const mod = require('../scripts/run-server-supervised.js');
    return fn(mod);
  } finally {
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    delete require.cache[scriptPath];
  }
}

test('supervisor resolves configured port from PORT env var', () => {
  withPort(3002, (mod) => {
    assert.equal(mod.resolvePort(), 3002);
  });

  withPort(undefined, (mod) => {
    assert.equal(mod.resolvePort(), 3000);
  });
});
