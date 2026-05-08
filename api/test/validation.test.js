const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateAiAnalysisConfig,
  validateGaggiuinoConfig,
  validateImportLatestRequest,
  validateStorageImport,
  validateStoragePut,
} = require('../src/validation');

test('ai analysis config requires object', () => {
  assert.throws(() => validateAiAnalysisConfig(null));
  assert.doesNotThrow(() => validateAiAnalysisConfig({ enabled: true }));
});

test('storage import requires bounded object', () => {
  assert.throws(() => validateStorageImport({}));
  assert.doesNotThrow(() => validateStorageImport({ A: 1 }));
});

test('storage put requires value field', () => {
  assert.throws(() => validateStoragePut({}));
  assert.doesNotThrow(() => validateStoragePut({ value: { ok: true } }));
});

test('gaggiuino config validates base url and booleans', () => {
  assert.throws(() => validateGaggiuinoConfig({ baseUrl: 'ftp://x' }));
  assert.doesNotThrow(() =>
    validateGaggiuinoConfig({
      baseUrl: 'http://example.local',
      timeoutMs: 1200,
      autoSyncEnabled: true,
    }),
  );
});

test('import latest validates count and sync flag', () => {
  assert.throws(() => validateImportLatestRequest({ count: 0 }));
  assert.throws(() => validateImportLatestRequest({ syncToBrews: 'yes' }));
  assert.doesNotThrow(() =>
    validateImportLatestRequest({ count: 10, syncToBrews: false }),
  );
});
