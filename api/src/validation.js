const { HttpError } = require('./http');

function assertObject(value, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, code, message);
  }
}

function assertBoolean(value, code, message) {
  if (typeof value !== 'boolean') {
    throw new HttpError(400, code, message);
  }
}

function assertString(value, code, message) {
  if (typeof value !== 'string') {
    throw new HttpError(400, code, message);
  }
}

function assertNumberInRange(value, min, max, code, message) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, code, message);
  }
}

function validateStorageImport(body) {
  assertObject(body, 'invalid_storage_import', 'Storage import body must be object');
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.length > 5000) {
    throw new HttpError(
      400,
      'invalid_storage_import',
      'Storage import must contain 1-5000 keys',
    );
  }
}

function validateStoragePut(body) {
  assertObject(body, 'invalid_storage_value', 'Storage value body must be object');
  if (!Object.prototype.hasOwnProperty.call(body, 'value')) {
    throw new HttpError(400, 'invalid_storage_value', 'Storage value body invalid');
  }
}

function validateGaggiuinoConfig(body) {
  assertObject(body, 'invalid_gaggiuino_config', 'Gaggiuino config body must be object');
  if (Object.prototype.hasOwnProperty.call(body, 'baseUrl')) {
    assertString(
      body.baseUrl,
      'invalid_gaggiuino_config',
      'Gaggiuino baseUrl must be string',
    );
    if (!/^https?:\/\//i.test(body.baseUrl)) {
      throw new HttpError(
        400,
        'invalid_gaggiuino_config',
        'Gaggiuino baseUrl must start with http:// or https://',
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'timeoutMs')) {
    assertNumberInRange(
      Number(body.timeoutMs),
      500,
      30000,
      'invalid_gaggiuino_config',
      'Gaggiuino timeoutMs must be between 500 and 30000',
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, 'designatedMillUuid')) {
    assertString(
      body.designatedMillUuid,
      'invalid_gaggiuino_config',
      'Gaggiuino designatedMillUuid must be string',
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, 'autoSyncEnabled')) {
    assertBoolean(
      body.autoSyncEnabled,
      'invalid_gaggiuino_config',
      'Gaggiuino autoSyncEnabled must be boolean',
    );
  }
}

function validateAiAnalysisConfig(body) {
  assertObject(body, 'invalid_ai_analysis_config', 'AI analysis config body must be object');
  if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
    assertBoolean(
      body.enabled,
      'invalid_ai_analysis_config',
      'AI enabled must be boolean',
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, 'cadenceHours')) {
    assertNumberInRange(
      Number(body.cadenceHours),
      1,
      168,
      'invalid_ai_analysis_config',
      'AI cadenceHours must be between 1 and 168',
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, 'maxRecommendations')) {
    assertNumberInRange(
      Number(body.maxRecommendations),
      1,
      10,
      'invalid_ai_analysis_config',
      'AI maxRecommendations must be between 1 and 10',
    );
  }
}

function validateImportLatestRequest(body) {
  assertObject(body, 'invalid_import_request', 'Import request body must be object');
  if (Object.prototype.hasOwnProperty.call(body, 'count')) {
    assertNumberInRange(
      Number(body.count),
      1,
      200,
      'invalid_import_request',
      'Import count must be between 1 and 200',
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, 'syncToBrews')) {
    assertBoolean(
      body.syncToBrews,
      'invalid_import_request',
      'syncToBrews must be boolean',
    );
  }
}

module.exports = {
  validateAiAnalysisConfig,
  validateGaggiuinoConfig,
  validateImportLatestRequest,
  validateStorageImport,
  validateStoragePut,
};
