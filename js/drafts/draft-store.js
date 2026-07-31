/**
 * Archivio IndexedDB autonomo per le bozze di Sapori.
 *
 * Ogni modulo usa una chiave con scope (`create:<draftId>` oppure
 * `edit:<recipeId>:<draftId>`), così schede diverse non si sovrascrivono.
 * Revisioni e rimozioni condizionali evitano inoltre che una chiusura tardiva
 * cancelli una bozza appena aggiornata.
 */
(function (global) {
  'use strict';

  var DATABASE_NAME = 'SaporiDraftsDB';
  var DATABASE_VERSION = 1;
  var STORE_NAME = 'drafts';
  var DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  var database = null;
  var initPromise = null;

  function draftError(message, cause, code) {
    if (cause && cause.name === 'DraftStoreError') return cause;
    var error = new Error(message);
    error.name = 'DraftStoreError';
    error.code = code || 'DRAFT_STORE_ERROR';
    if (cause) error.cause = cause;
    return error;
  }

  function normalizeDatabaseError(action, error) {
    if (error && error.name === 'DraftStoreError') return error;
    if (error && error.name === 'QuotaExceededError') {
      return draftError(
        'Spazio locale insufficiente: libera spazio o rimuovi una foto dalla bozza.',
        error,
        'QUOTA_EXCEEDED'
      );
    }
    if (error && error.name === 'DataCloneError') {
      return draftError(
        'La bozza contiene dati che il browser non può salvare.',
        error,
        'INVALID_DATA'
      );
    }
    return draftError(
      'Impossibile ' + action + ' la bozza locale' +
        (error && error.message ? ': ' + error.message : '.'),
      error
    );
  }

  function safeToken(value, label) {
    var token = typeof value === 'string' ? value.trim() : '';
    if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(token)) {
      throw draftError(label + ' non valido.', null, 'INVALID_TARGET');
    }
    return token;
  }

  function normalizeTarget(target) {
    if (!target || Object.prototype.toString.call(target) !== '[object Object]') {
      throw draftError('Destinazione della bozza non valida.', null, 'INVALID_TARGET');
    }
    if (target.mode !== 'create' && target.mode !== 'edit') {
      throw draftError(
        'Tipo di bozza non valido: usa "create" oppure "edit".',
        null,
        'INVALID_TARGET'
      );
    }

    var draftId = safeToken(target.draftId, 'ID bozza');
    if (target.mode === 'create') {
      return {
        key: 'create:' + draftId,
        mode: 'create',
        recipeId: null,
        draftId: draftId
      };
    }

    var recipeId = safeToken(target.recipeId, 'ID ricetta');
    return {
      key: 'edit:' + recipeId + ':' + draftId,
      mode: 'edit',
      recipeId: recipeId,
      draftId: draftId
    };
  }

  function normalizeListFilters(filters) {
    if (filters === undefined) {
      return { mode: null, recipeId: null };
    }
    if (!filters || Object.prototype.toString.call(filters) !== '[object Object]') {
      throw draftError('Filtri delle bozze non validi.', null, 'INVALID_FILTER');
    }
    Object.keys(filters).forEach(function (key) {
      if (key !== 'mode' && key !== 'recipeId') {
        throw draftError(
          'Filtro bozze non riconosciuto: ' + key + '.',
          null,
          'INVALID_FILTER'
        );
      }
    });

    var hasMode = Object.prototype.hasOwnProperty.call(filters, 'mode');
    var hasRecipeId = Object.prototype.hasOwnProperty.call(filters, 'recipeId');
    var mode = null;
    var recipeId = null;

    if (hasMode) {
      if (filters.mode !== 'create' && filters.mode !== 'edit') {
        throw draftError(
          'Filtro tipo bozza non valido: usa "create" oppure "edit".',
          null,
          'INVALID_FILTER'
        );
      }
      mode = filters.mode;
    }
    if (hasRecipeId) {
      try {
        recipeId = safeToken(filters.recipeId, 'ID ricetta');
      } catch (error) {
        throw draftError('Filtro ID ricetta non valido.', null, 'INVALID_FILTER');
      }
    }
    if (mode === 'create' && recipeId !== null) {
      throw draftError(
        'Il filtro ID ricetta può essere usato soltanto con bozze di modifica.',
        null,
        'INVALID_FILTER'
      );
    }

    return { mode: mode, recipeId: recipeId };
  }

  function recordRevision(record) {
    var revision = record ? Number(record.revision) : NaN;
    return Number.isInteger(revision) && revision > 0 ? revision : null;
  }

  function conflictError(record) {
    var error = draftError(
      record
        ? 'La bozza è stata modificata da un’altra sessione.'
        : 'La bozza attesa non esiste più.',
      null,
      'DRAFT_CONFLICT'
    );
    error.currentRevision = recordRevision(record);
    error.currentWriterId = record && typeof record.writerId === 'string'
      ? record.writerId
      : null;
    return error;
  }

  function assertPlainData(value, path, seen) {
    var location = path || 'bozza';
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw draftError(location + ' contiene un numero non valido.', null, 'INVALID_DATA');
      }
      return;
    }
    if (typeof value !== 'object') {
      throw draftError(
        location + ' contiene un valore non salvabile.',
        null,
        'INVALID_DATA'
      );
    }
    if (seen.has(value)) {
      throw draftError(location + ' contiene un riferimento circolare.', null, 'INVALID_DATA');
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach(function (item, index) {
        assertPlainData(item, location + '[' + index + ']', seen);
      });
    } else {
      if (Object.prototype.toString.call(value) !== '[object Object]') {
        throw draftError(
          location + ' deve contenere soltanto dati semplici.',
          null,
          'INVALID_DATA'
        );
      }
      Object.keys(value).forEach(function (key) {
        assertPlainData(value[key], location + '.' + key, seen);
      });
    }
    seen.delete(value);
  }

  function cloneDraftData(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
      throw draftError('La bozza deve essere un oggetto.', null, 'INVALID_DATA');
    }
    assertPlainData(value, 'bozza', new Set());

    try {
      if (typeof global.structuredClone === 'function') {
        return global.structuredClone(value);
      }
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      throw normalizeDatabaseError('copiare', error);
    }
  }

  function publicRecord(record) {
    if (!record) return null;
    return {
      mode: record.mode,
      recipeId: record.recipeId || null,
      draftId: record.draftId,
      data: cloneDraftData(record.data),
      writerId: record.writerId || null,
      revision: Number(record.revision) || 1,
      createdAt: Number(record.createdAt),
      updatedAt: Number(record.updatedAt),
      expiresAt: Number(record.expiresAt)
    };
  }

  function isExpired(record, now) {
    return !record ||
      !Number.isFinite(Number(record.expiresAt)) ||
      Number(record.expiresAt) <= now;
  }

  function requestResult(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () {
        reject(request.error || new Error('Richiesta IndexedDB non riuscita'));
      };
    });
  }

  function transactionComplete(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () {
        reject(transaction.error || new Error('Transazione IndexedDB non riuscita'));
      };
      transaction.onabort = function () {
        reject(transaction.error || new Error('Transazione IndexedDB annullata'));
      };
    });
  }

  async function runTransaction(transaction, operation) {
    // Aggancia subito entrambi gli esiti: una transazione può fallire mentre
    // l'operazione sta ancora attendendo una singola richiesta IndexedDB.
    // Convertire il completamento in un risultato evita rejection non gestite.
    var completion = transactionComplete(transaction).then(
      function () { return { ok: true, error: null }; },
      function (error) { return { ok: false, error: error }; }
    );
    var result;
    var operationError = null;

    try {
      result = await operation();
    } catch (error) {
      operationError = error;
    }

    var transactionResult = await completion;
    if (operationError) throw operationError;
    if (!transactionResult.ok) throw transactionResult.error;
    return result;
  }

  async function init() {
    if (database) return database;
    if (initPromise) return initPromise;
    if (!global.indexedDB || typeof global.indexedDB.open !== 'function') {
      throw draftError('IndexedDB non è disponibile in questo browser.', null, 'UNSUPPORTED');
    }

    initPromise = new Promise(function (resolve, reject) {
      var settled = false;
      var request;
      try {
        request = global.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      } catch (error) {
        reject(normalizeDatabaseError('aprire', error));
        return;
      }

      request.onupgradeneeded = function () {
        var openedDatabase = request.result;
        if (!openedDatabase.objectStoreNames.contains(STORE_NAME)) {
          var store = openedDatabase.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('expiresAt', 'expiresAt', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('mode', 'mode', { unique: false });
        }
      };
      request.onerror = function () {
        if (settled) return;
        settled = true;
        reject(normalizeDatabaseError('aprire', request.error));
      };
      request.onblocked = function () {
        if (settled) return;
        settled = true;
        reject(draftError(
          'L’archivio delle bozze è aperto in un’altra scheda non aggiornata.',
          null,
          'BLOCKED'
        ));
      };
      request.onsuccess = function () {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        database = request.result;
        database.onversionchange = function () {
          database.close();
          database = null;
        };
        database.onclose = function () {
          database = null;
        };
        resolve(database);
      };
    });

    try {
      return await initPromise;
    } finally {
      initPromise = null;
    }
  }

  async function get(target) {
    var normalized = normalizeTarget(target);
    try {
      var openedDatabase = await init();
      var transaction = openedDatabase.transaction(STORE_NAME, 'readwrite');
      var store = transaction.objectStore(STORE_NAME);
      return await runTransaction(transaction, async function () {
        var record = await requestResult(store.get(normalized.key));
        if (!record) return null;
        if (isExpired(record, Date.now())) {
          store.delete(normalized.key);
          return null;
        }
        return publicRecord(record);
      });
    } catch (error) {
      throw normalizeDatabaseError('leggere', error);
    }
  }

  async function save(target, draftData, options) {
    var normalized = normalizeTarget(target);
    var safeData = cloneDraftData(draftData);
    options = options || {};
    var writerId = options.writerId
      ? safeToken(options.writerId, 'ID sessione')
      : null;
    var hasExpectedRevision = Object.prototype.hasOwnProperty.call(
      options,
      'expectedRevision'
    );
    var expectedRevision = hasExpectedRevision ? options.expectedRevision : null;
    if (
      hasExpectedRevision &&
      expectedRevision !== null &&
      (
        typeof expectedRevision !== 'number' ||
        !Number.isInteger(expectedRevision) ||
        expectedRevision < 1
      )
    ) {
      throw draftError(
        'Revisione attesa della bozza non valida.',
        null,
        'INVALID_REVISION'
      );
    }

    try {
      var openedDatabase = await init();
      var transaction = openedDatabase.transaction(STORE_NAME, 'readwrite');
      var store = transaction.objectStore(STORE_NAME);
      return await runTransaction(transaction, async function () {
        var previous = await requestResult(store.get(normalized.key));
        var now = Date.now();
        var validPrevious = previous && !isExpired(previous, now) ? previous : null;
        if (previous && !validPrevious) store.delete(normalized.key);

        if (hasExpectedRevision) {
          if (expectedRevision === null) {
            if (validPrevious) throw conflictError(validPrevious);
          } else if (
            !validPrevious ||
            recordRevision(validPrevious) !== expectedRevision
          ) {
            throw conflictError(validPrevious);
          }
        }

        var record = {
          key: normalized.key,
          mode: normalized.mode,
          recipeId: normalized.recipeId,
          draftId: normalized.draftId,
          data: safeData,
          writerId: writerId,
          revision: validPrevious ? recordRevision(validPrevious) + 1 : 1,
          createdAt: validPrevious && Number.isFinite(Number(validPrevious.createdAt))
            ? Number(validPrevious.createdAt)
            : now,
          updatedAt: now,
          expiresAt: now + DRAFT_TTL_MS
        };
        store.put(record);
        return publicRecord(record);
      });
    } catch (error) {
      throw normalizeDatabaseError('salvare', error);
    }
  }

  async function list(filters) {
    var normalizedFilters = normalizeListFilters(filters);
    try {
      var openedDatabase = await init();
      var transaction = openedDatabase.transaction(STORE_NAME, 'readwrite');
      var store = transaction.objectStore(STORE_NAME);
      return await runTransaction(transaction, function () {
        return new Promise(function (resolve, reject) {
          var now = Date.now();
          var records = [];
          var request = store.openCursor();
          request.onerror = function () {
            reject(request.error || new Error('Scansione bozze non riuscita'));
          };
          request.onsuccess = function () {
            var cursor = request.result;
            if (!cursor) {
              records.sort(function (first, second) {
                var byUpdate = second.updatedAt - first.updatedAt;
                if (byUpdate !== 0) return byUpdate;
                var firstKey = first.mode + ':' + (first.recipeId || '') + ':' + first.draftId;
                var secondKey = second.mode + ':' + (second.recipeId || '') + ':' + second.draftId;
                return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0;
              });
              resolve(records);
              return;
            }

            try {
              var record = cursor.value;
              if (isExpired(record, now)) {
                cursor.delete();
              } else if (
                (normalizedFilters.mode === null || record.mode === normalizedFilters.mode) &&
                (
                  normalizedFilters.recipeId === null ||
                  (
                    record.mode === 'edit' &&
                    record.recipeId === normalizedFilters.recipeId
                  )
                )
              ) {
                records.push(publicRecord(record));
              }
              cursor.continue();
            } catch (error) {
              reject(error);
            }
          };
        });
      });
    } catch (error) {
      throw normalizeDatabaseError('elencare', error);
    }
  }

  async function remove(target, options) {
    var normalized = normalizeTarget(target);
    options = options || {};
    var expectedRevision = options.expectedRevision === undefined
      ? null
      : Number(options.expectedRevision);

    try {
      var openedDatabase = await init();
      var transaction = openedDatabase.transaction(STORE_NAME, 'readwrite');
      var store = transaction.objectStore(STORE_NAME);
      return await runTransaction(transaction, async function () {
        var existing = await requestResult(store.get(normalized.key));
        if (!existing) return false;
        if (
          expectedRevision !== null &&
          (!Number.isInteger(expectedRevision) || Number(existing.revision) !== expectedRevision)
        ) {
          return false;
        }
        store.delete(normalized.key);
        return true;
      });
    } catch (error) {
      throw normalizeDatabaseError('rimuovere', error);
    }
  }

  async function cleanup() {
    try {
      var openedDatabase = await init();
      var transaction = openedDatabase.transaction(STORE_NAME, 'readwrite');
      var store = transaction.objectStore(STORE_NAME);
      return await runTransaction(transaction, function () {
        return new Promise(function (resolve, reject) {
          var now = Date.now();
          var removed = 0;
          var request = store.openCursor();
          request.onerror = function () {
            reject(request.error || new Error('Scansione bozze non riuscita'));
          };
          request.onsuccess = function () {
            var cursor = request.result;
            if (!cursor) {
              resolve(removed);
              return;
            }
            if (isExpired(cursor.value, now)) {
              cursor.delete();
              removed += 1;
            }
            cursor.continue();
          };
        });
      });
    } catch (error) {
      throw normalizeDatabaseError('ripulire', error);
    }
  }

  global.DraftStore = {
    DATABASE_NAME: DATABASE_NAME,
    DATABASE_VERSION: DATABASE_VERSION,
    STORE_NAME: STORE_NAME,
    DRAFT_TTL_MS: DRAFT_TTL_MS,
    init: init,
    get: get,
    save: save,
    list: list,
    remove: remove,
    cleanup: cleanup
  };
})(typeof window !== 'undefined' ? window : globalThis);
