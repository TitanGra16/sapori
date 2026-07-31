/**
 * Diagnostica non invasiva dello spazio locale disponibile.
 *
 * read() usa soltanto estimate() e persisted(): non apre richieste di permesso.
 * requestPersistence() è l'unico metodo che invoca persist() e va quindi
 * collegato esclusivamente a un'azione esplicita dell'utente.
 */
(function () {
  'use strict';

  var THRESHOLDS = Object.freeze({
    warningRatio: 0.75,
    criticalRatio: 0.90
  });
  var READ_TIMEOUT_MS = 1500;
  var REQUEST_TIMEOUT_MS = 5000;

  function storageManager() {
    try {
      return window.navigator && window.navigator.storage
        ? window.navigator.storage
        : null;
    } catch (error) {
      return null;
    }
  }

  function normalizeBytes(value, allowZero) {
    if (value === undefined || value === null || value === '') return null;
    var number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) {
      return null;
    }
    return Math.round(number);
  }

  function safeErrorMessage(error) {
    if (!error) return 'Errore sconosciuto';
    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim().slice(0, 300);
    }
    return String(error).slice(0, 300);
  }

  function classify(ratio) {
    if (!Number.isFinite(ratio)) return 'unknown';
    if (ratio >= THRESHOLDS.criticalRatio) return 'critical';
    if (ratio >= THRESHOLDS.warningRatio) return 'warning';
    return 'healthy';
  }

  function withTimeout(value, timeoutMs, label) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error(label + ' non ha risposto in tempo'));
      }, timeoutMs);
      Promise.resolve(value).then(function (result) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(result);
      }, function (error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      });
    });
  }

  function formatBytes(value) {
    var bytes = normalizeBytes(value, true);
    if (bytes === null) return 'Non disponibile';
    if (bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var unitIndex = Math.min(
      units.length - 1,
      Math.floor(Math.log(bytes) / Math.log(1024))
    );
    var amount = bytes / Math.pow(1024, unitIndex);
    return new Intl.NumberFormat('it-IT', {
      maximumFractionDigits: unitIndex === 0 ? 0 : 1
    }).format(amount) + ' ' + units[unitIndex];
  }

  function unsupportedResult() {
    return {
      supported: false,
      estimateSupported: false,
      persistenceStatusSupported: false,
      persistenceRequestSupported: false,
      usageBytes: null,
      quotaBytes: null,
      availableBytes: null,
      usageRatio: null,
      usagePercent: null,
      level: 'unknown',
      persisted: null,
      errors: {
        estimate: null,
        persisted: null
      }
    };
  }

  async function read(options) {
    options = options || {};
    var timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Math.max(1, Number(options.timeoutMs))
      : READ_TIMEOUT_MS;
    var manager = storageManager();
    if (!manager) return unsupportedResult();

    var estimateSupported = typeof manager.estimate === 'function';
    var persistenceStatusSupported = typeof manager.persisted === 'function';
    var persistenceRequestSupported = typeof manager.persist === 'function';
    var estimate = null;
    var persisted = null;
    var estimateError = null;
    var persistedError = null;

    // Le due letture sono indipendenti: eseguirle insieme evita che un browser
    // lento raddoppi il tempo di apertura delle Impostazioni.
    var estimateTask = estimateSupported
      ? (async function () {
          try {
            estimate = await withTimeout(
              manager.estimate(),
              timeoutMs,
              'La stima dello spazio'
            );
          } catch (error) {
            estimateError = safeErrorMessage(error);
          }
        })()
      : Promise.resolve();
    var persistedTask = persistenceStatusSupported
      ? (async function () {
          try {
            var persistedResult = await withTimeout(
              manager.persisted(),
              timeoutMs,
              'Lo stato di protezione'
            );
            persisted = typeof persistedResult === 'boolean' ? persistedResult : null;
          } catch (error) {
            persistedError = safeErrorMessage(error);
          }
        })()
      : Promise.resolve();

    await Promise.all([estimateTask, persistedTask]);

    var usageBytes = normalizeBytes(estimate && estimate.usage, true);
    var quotaBytes = normalizeBytes(estimate && estimate.quota, false);
    var availableBytes = usageBytes !== null && quotaBytes !== null
      ? Math.max(0, quotaBytes - usageBytes)
      : null;
    var usageRatio = usageBytes !== null && quotaBytes !== null
      ? Math.min(1, Math.max(0, usageBytes / quotaBytes))
      : null;
    var normalizedRatio = usageRatio === null
      ? null
      : Math.round(usageRatio * 10000) / 10000;

    return {
      supported: estimateSupported || persistenceStatusSupported || persistenceRequestSupported,
      estimateSupported: estimateSupported,
      persistenceStatusSupported: persistenceStatusSupported,
      persistenceRequestSupported: persistenceRequestSupported,
      usageBytes: usageBytes,
      quotaBytes: quotaBytes,
      availableBytes: availableBytes,
      usageRatio: normalizedRatio,
      usagePercent: normalizedRatio === null
        ? null
        : Math.round(normalizedRatio * 1000) / 10,
      level: classify(normalizedRatio),
      persisted: persisted,
      errors: {
        estimate: estimateError,
        persisted: persistedError
      }
    };
  }

  async function requestPersistence(options) {
    options = options || {};
    var timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Math.max(1, Number(options.timeoutMs))
      : REQUEST_TIMEOUT_MS;
    var manager = storageManager();
    if (!manager || typeof manager.persist !== 'function') {
      var unsupported = await read(options);
      return {
        ...unsupported,
        persistenceRequested: false,
        persistenceGranted: null,
        requestError: null
      };
    }

    var granted = null;
    var requestError = null;
    try {
      granted = (await withTimeout(
        manager.persist(),
        timeoutMs,
        'La richiesta di protezione'
      )) === true;
    } catch (error) {
      requestError = safeErrorMessage(error);
    }

    var current = await read(options);
    return {
      ...current,
      persistenceRequested: true,
      persistenceGranted: granted,
      requestError: requestError
    };
  }

  window.StorageHealth = {
    THRESHOLDS: THRESHOLDS,
    READ_TIMEOUT_MS: READ_TIMEOUT_MS,
    REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
    formatBytes: formatBytes,
    read: read,
    requestPersistence: requestPersistence
  };
})();
