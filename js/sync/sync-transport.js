/**
 * Trasporto Supabase della sincronizzazione.
 *
 * Questo modulo conosce soltanto RPC e Storage: non accede a IndexedDB e non
 * modifica il DOM. Token, payload e URL firmati non vengono mai registrati.
 */
(function () {
  'use strict';

  var BUCKET = 'recipe-images';
  var DEFAULT_TIMEOUT_MS = 25000;

  function SyncTransportError(details, cause) {
    details = details || {};
    this.name = 'SyncTransportError';
    this.code = details.code || 'sync-transport-error';
    this.category = details.category || 'unknown';
    this.status = Number.isFinite(Number(details.status)) ? Number(details.status) : null;
    this.retryable = details.retryable === true;
    this.reauthRequired = details.reauthRequired === true;
    this.message = details.message || 'Sincronizzazione cloud non disponibile.';
    if (cause) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        enumerable: false,
        value: cause
      });
    }
    if (Error.captureStackTrace) Error.captureStackTrace(this, SyncTransportError);
  }
  SyncTransportError.prototype = Object.create(Error.prototype);
  SyncTransportError.prototype.constructor = SyncTransportError;

  function safeCode(value) {
    return typeof value === 'string'
      ? value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 100)
      : '';
  }

  function classify(error) {
    if (error instanceof SyncTransportError) return error;
    var status = Number(error && (error.status || error.statusCode));
    var code = safeCode(error && error.code) || 'sync-request-failed';
    var message = typeof (error && error.message) === 'string' ? error.message : '';
    var offline = window.navigator && window.navigator.onLine === false;
    var network = offline || (error && ['TypeError', 'AbortError'].indexOf(error.name) !== -1) ||
      /fetch|network|load failed|timed out|abort(?:ed|error)?/i.test(message);

    if (error && error.retryable === true) {
      return new SyncTransportError({
        code: code,
        category: typeof error.category === 'string' ? error.category : 'temporary',
        status: status,
        retryable: true,
        reauthRequired: error.reauthRequired === true,
        message: message || 'La sincronizzazione verrà riprovata.'
      }, error);
    }
    if (code === '28000') {
      return new SyncTransportError({
        code: 'sync-account-mismatch',
        category: 'authentication',
        status: status,
        retryable: false,
        reauthRequired: false,
        message: 'L\u2019account attivo è cambiato durante la sincronizzazione.'
      }, error);
    }
    if (status === 401 || code === 'pgrst301' || code === 'jwt_expired') {
      return new SyncTransportError({
        code: code,
        category: 'authentication',
        status: status || 401,
        retryable: true,
        reauthRequired: true,
        message: 'La sessione cloud deve essere rinnovata.'
      }, error);
    }
    if (network) {
      return new SyncTransportError({
        code: offline ? 'offline' : code,
        category: offline ? 'offline' : 'network',
        status: status,
        retryable: true,
        message: offline
          ? 'Sei offline: le modifiche restano al sicuro sul dispositivo.'
          : 'Il servizio cloud non è raggiungibile.'
      }, error);
    }
    if (status === 429) {
      return new SyncTransportError({
        code: code,
        category: 'rate-limit',
        status: status,
        retryable: true,
        message: 'Troppe richieste ravvicinate; la sincronizzazione riproverà.'
      }, error);
    }
    if (status === 408 || status === 409 || code === '40001') {
      return new SyncTransportError({
        code: code,
        category: 'concurrency',
        status: status,
        retryable: true,
        message: 'Il cloud sta elaborando la stessa modifica; riproveremo.'
      }, error);
    }
    if (status >= 500) {
      return new SyncTransportError({
        code: code,
        category: 'service',
        status: status,
        retryable: true,
        message: 'Il servizio cloud è temporaneamente indisponibile.'
      }, error);
    }
    if (status === 403 || code === '42501') {
      return new SyncTransportError({
        code: code,
        category: 'permission',
        status: status || 403,
        retryable: false,
        message: 'Il cloud ha rifiutato questa operazione.'
      }, error);
    }
    return new SyncTransportError({
      code: code,
      category: 'invalid-request',
      status: status,
      retryable: false,
      message: 'Una modifica non può essere sincronizzata automaticamente.'
    }, error);
  }

  function requireClient() {
    if (!window.SaporiSupabaseClient) {
      throw classify({ code: 'sync-client-missing', status: 503 });
    }
    return window.SaporiSupabaseClient.getClient();
  }

  function requireExpectedOwnerId(value) {
    var normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
      throw new SyncTransportError({
        code: 'invalid-expected-owner',
        category: 'authentication',
        retryable: false,
        message: 'Account di sincronizzazione non valido.'
      });
    }
    return normalized;
  }

  async function withTimeout(buildRequest, timeoutMs) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    var timedOut = false;
    try {
      var request = buildRequest();
      if (controller && request && typeof request.abortSignal === 'function') {
        request = request.abortSignal(controller.signal);
      }
      if (controller) {
        timer = window.setTimeout(function () {
          timedOut = true;
          controller.abort();
        }, timeoutMs || DEFAULT_TIMEOUT_MS);
      }
      var response = await request;
      // PostgREST puo risolvere la Promise con `response.error` dopo un abort,
      // invece di lanciare AbortError. Il segnale e il flag restano quindi la
      // fonte affidabile per distinguere un timeout da una richiesta invalida.
      if (timedOut || (controller && controller.signal.aborted)) {
        throw new SyncTransportError({
          code: 'sync-timeout',
          category: 'network',
          retryable: true,
          message: 'La richiesta cloud ha impiegato troppo tempo.'
        });
      }
      return response;
    } catch (error) {
      if (timedOut || (controller && controller.signal.aborted) ||
          (error && error.name === 'AbortError')) {
        throw new SyncTransportError({
          code: 'sync-timeout',
          category: 'network',
          retryable: true,
          message: 'La richiesta cloud ha impiegato troppo tempo.'
        }, error);
      }
      throw classify(error);
    } finally {
      if (timer !== null) window.clearTimeout(timer);
    }
  }

  function withPromiseTimeout(promise, timeoutMs) {
    var timer = null;
    var timeout = new Promise(function (_, reject) {
      timer = window.setTimeout(function () {
        reject(new SyncTransportError({
          code: 'sync-timeout',
          category: 'network',
          retryable: true,
          message: 'La richiesta cloud ha impiegato troppo tempo.'
        }));
      }, timeoutMs || DEFAULT_TIMEOUT_MS);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(function () {
      if (timer !== null) window.clearTimeout(timer);
    });
  }

  function throwResponseError(response) {
    if (response && response.error) {
      var error = response.error;
      throw classify({
        ...(error && typeof error === 'object' ? error : {}),
        name: error && error.name,
        message: error && error.message,
        status: Number.isFinite(Number(response.status))
          ? Number(response.status)
          : (error && (error.status || error.statusCode))
      });
    }
    return response ? response.data : null;
  }

  async function push(operation, payload, expectedOwnerId) {
    if (!operation || typeof operation !== 'object') {
      throw new SyncTransportError({
        code: 'invalid-operation',
        category: 'invalid-request',
        retryable: false,
        message: 'Operazione locale non valida.'
      });
    }
    expectedOwnerId = requireExpectedOwnerId(expectedOwnerId);
    var client = requireClient();
    var response = await withTimeout(function () {
      return client.rpc('apply_sync_operation', {
        p_expected_owner_id: expectedOwnerId,
        p_operation_id: operation.operationId,
        p_device_id: operation.deviceId,
        p_entity_type: operation.entityType,
        p_entity_id: operation.entityId,
        p_channel: operation.channel,
        p_action: operation.action,
        p_base_server_version: operation.baseServerVersion,
        p_payload: payload || {}
      });
    });
    var result = throwResponseError(response);
    if (!result || ['applied', 'conflict'].indexOf(result.status) === -1) {
      throw new SyncTransportError({
        code: 'invalid-server-response',
        category: 'service',
        retryable: true,
        message: 'Il cloud ha restituito una risposta incompleta.'
      });
    }
    if (String(result.operationId || '').toLowerCase() !==
        String(operation.operationId || '').toLowerCase() ||
        !Number.isSafeInteger(Number(result.serverVersion)) || Number(result.serverVersion) < 0 ||
        !Number.isSafeInteger(Number(result.revision)) || Number(result.revision) < 0 ||
        (result.status === 'conflict' &&
          (!result.remote || typeof result.remote !== 'object' || Array.isArray(result.remote)))) {
      throw new SyncTransportError({
        code: 'invalid-server-response',
        category: 'service',
        retryable: true,
        message: 'Il cloud ha restituito dati di sincronizzazione non validi.'
      });
    }
    return result;
  }

  async function pull(afterRevision, limit, expectedOwnerId) {
    expectedOwnerId = requireExpectedOwnerId(expectedOwnerId);
    var client = requireClient();
    var response = await withTimeout(function () {
      return client.rpc('pull_sync_changes', {
        p_expected_owner_id: expectedOwnerId,
        p_after_revision: Math.max(0, Number(afterRevision) || 0),
        p_batch_limit: Math.max(1, Math.min(Number(limit) || 100, 500))
      });
    });
    var result = throwResponseError(response);
    if (!result || !Array.isArray(result.changes)) {
      throw new SyncTransportError({
        code: 'invalid-pull-response',
        category: 'service',
        retryable: true,
        message: 'Il cloud non ha restituito una pagina valida.'
      });
    }
    var normalizedAfter = Math.max(0, Number(afterRevision) || 0);
    var previousRevision = normalizedAfter;
    result.changes.forEach(function (change) {
      var revision = Number(change && change.revision);
      var entityType = change && change.entityType;
      var entityId = change && change.entityId;
      var payload = change && change.payload;
      var validEntity = entityType === 'recipe'
        ? (typeof entityId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(entityId))
        : (entityType === 'settings' && entityId === 'customCategories');
      var validPayload = false;
      if (entityType === 'recipe' && payload && typeof payload === 'object') {
        validPayload = payload.content && typeof payload.content === 'object' &&
          !Array.isArray(payload.content) && typeof payload.isFavorite === 'boolean' &&
          [payload.contentVersion, payload.favoriteVersion, payload.imageVersion]
            .every(function (version) {
              return Number.isSafeInteger(Number(version)) && Number(version) >= 0;
            }) &&
          (payload.imagePath === null ||
            (typeof payload.imagePath === 'string' && payload.imagePath.length <= 1024));
      } else if (entityType === 'settings' && payload && typeof payload === 'object') {
        validPayload = Array.isArray(payload.items) && payload.items.length <= 100 &&
          Number.isSafeInteger(Number(payload.categoriesVersion)) &&
          Number(payload.categoriesVersion) >= 0;
      }
      if (!change || typeof change !== 'object' || !validEntity ||
          !Number.isSafeInteger(revision) || revision <= normalizedAfter ||
          revision < previousRevision || !validPayload) {
        throw new SyncTransportError({
          code: 'invalid-pull-response',
          category: 'service',
          retryable: true,
          message: 'Il cloud ha restituito una modifica non valida.'
        });
      }
      previousRevision = revision;
    });
    var lastRevision = Number(result.lastRevision);
    var expectedLastRevision = result.changes.length > 0
      ? previousRevision
      : normalizedAfter;
    if (!Number.isSafeInteger(lastRevision) || lastRevision !== expectedLastRevision ||
        typeof result.hasMore !== 'boolean') {
      throw new SyncTransportError({
        code: 'invalid-pull-cursor',
        category: 'service',
        retryable: true,
        message: 'Il cloud ha restituito un cursore non valido.'
      });
    }
    return {
      changes: result.changes,
      lastRevision: lastRevision,
      hasMore: result.hasMore === true
    };
  }

  async function uploadImage(path, blob) {
    var client = requireClient();
    try {
      var response = await withPromiseTimeout(
        client.storage.from(BUCKET).upload(path, blob, {
          cacheControl: '31536000',
          contentType: blob.type,
          upsert: false
        })
      );
      if (response.error) {
        var duplicate = Number(response.error.statusCode || response.error.status) === 409 ||
          /already exists|duplicate/i.test(response.error.message || '');
        if (!duplicate) throw response.error;
      }
      return { path: path, alreadyExisted: Boolean(response.error) };
    } catch (error) {
      throw classify(error);
    }
  }

  async function downloadImage(path) {
    var client = requireClient();
    try {
      var response = await withPromiseTimeout(
        client.storage.from(BUCKET).download(path)
      );
      if (response.error) throw response.error;
      if (!(response.data instanceof Blob)) {
        throw new Error('Storage response is not a Blob');
      }
      return response.data;
    } catch (error) {
      throw classify(error);
    }
  }

  async function removeImages(paths) {
    var safePaths = Array.from(new Set((paths || []).filter(function (path) {
      return typeof path === 'string' && path.length > 0 && path.length <= 1024;
    })));
    if (safePaths.length === 0) return { removed: 0 };
    try {
      var response = await withPromiseTimeout(
        requireClient().storage.from(BUCKET).remove(safePaths)
      );
      if (response.error) throw response.error;
      return { removed: safePaths.length };
    } catch (error) {
      throw classify(error);
    }
  }

  window.SyncTransport = Object.freeze({
    BUCKET: BUCKET,
    SyncTransportError: SyncTransportError,
    classifyError: classify,
    push: push,
    pull: pull,
    uploadImage: uploadImage,
    downloadImage: downloadImage,
    removeImages: removeImages
  });
})();
