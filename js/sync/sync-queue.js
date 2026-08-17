/**
 * Coda locale affidabile per la sincronizzazione di Sapori.
 *
 * Il modulo non conosce Supabase e non legge i payload delle ricette. Gestisce
 * esclusivamente il coordinamento persistente della coda: un lease globale per
 * database, claim atomici, conferme condizionali e recupero dopo un crash.
 */
(function () {
  'use strict';

  var QUEUE_STORE = 'syncQueue';
  var META_STORE = 'syncMeta';
  var SHADOW_STORE = 'syncShadow';
  var STATE_KEY = 'state';
  var LEASE_KEY = 'queueLease';
  var DEFAULT_LEASE_MS = 30 * 1000;
  var MIN_LEASE_MS = 5 * 1000;
  var MAX_LEASE_MS = 2 * 60 * 1000;
  var DEFAULT_BATCH_SIZE = 20;
  var MAX_BATCH_SIZE = 100;
  var DEFAULT_RETRY_MS = 1500;
  var MAX_RETRY_MS = 5 * 60 * 1000;

  function requestResult(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function transactionComplete(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error); };
      transaction.onabort = function () {
        reject(transaction.error || new Error('Transazione della coda annullata'));
      };
    });
  }

  function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (character) {
      var random = Math.floor(Math.random() * 16);
      var value = character === 'x' ? random : ((random & 0x3) | 0x8);
      return value.toString(16);
    });
  }

  async function ensureDatabase() {
    if (!window.DB || typeof window.DB._ensureDB !== 'function') {
      throw new Error('Archivio locale non disponibile');
    }
    var database = await window.DB._ensureDB();
    if (!database.objectStoreNames.contains(QUEUE_STORE) ||
        !database.objectStoreNames.contains(META_STORE)) {
      throw new Error('Struttura della coda non disponibile');
    }
    return database;
  }

  function nowFrom(options) {
    return options && Number.isFinite(Number(options.now))
      ? Number(options.now)
      : Date.now();
  }

  function clampInteger(value, fallback, minimum, maximum) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
  }

  function normalizeWorkerId(workerId) {
    if (typeof workerId !== 'string') return null;
    var normalized = workerId.trim();
    return normalized && normalized.length <= 256 ? normalized : null;
  }

  function notifyQueueChanged(reason, triggerSync) {
    if (!window.SyncPreparation ||
        typeof window.SyncPreparation.notifyQueueChanged !== 'function') return;
    window.SyncPreparation.notifyQueueChanged(reason, {
      triggerSync: triggerSync !== false
    });
  }

  function stateIsPrepared(record) {
    return Boolean(
      record &&
      record.key === STATE_KEY &&
      record.intentEnabled === true &&
      typeof record.localProfileId === 'string' && record.localProfileId &&
      typeof record.ownerScope === 'string' && record.ownerScope
    );
  }

  function stateHasAccount(record) {
    return stateIsPrepared(record) &&
      typeof record.accountId === 'string' && Boolean(record.accountId);
  }

  function createStateError(record) {
    var error;
    if (!stateIsPrepared(record)) {
      error = new Error('La sincronizzazione locale non e stata preparata');
      error.code = 'SYNC_NOT_PREPARED';
    } else {
      error = new Error('Nessun account associato a questo archivio locale');
      error.code = 'SYNC_ACCOUNT_REQUIRED';
    }
    return error;
  }

  function leaseIdFrom(value) {
    if (typeof value === 'string') return value;
    return value && typeof value.leaseId === 'string' ? value.leaseId : null;
  }

  function isLeaseForState(lease, stateRecord) {
    return Boolean(
      lease &&
      lease.key === LEASE_KEY &&
      lease.ownerScope === stateRecord.ownerScope &&
      lease.accountId === stateRecord.accountId &&
      typeof lease.leaseId === 'string' && lease.leaseId
    );
  }

  function isLeaseActive(lease, stateRecord, now) {
    return isLeaseForState(lease, stateRecord) && Number(lease.expiresAt) > now;
  }

  function toPending(operation, now, reason) {
    return {
      ...operation,
      status: 'pending',
      nextAttemptAt: Math.min(Number(operation.nextAttemptAt) || now, now),
      leaseId: null,
      leaseExpiresAt: null,
      claimedAt: null,
      recoveredAt: now,
      recoveryReason: reason || 'lease-expired'
    };
  }

  function recoverOperations(queueStore, operations, stateRecord, activeLease, now, forceLeaseId) {
    var recovered = 0;
    operations.forEach(function (operation) {
      if (!operation || operation.ownerScope !== stateRecord.ownerScope ||
          operation.status !== 'sending') {
        return;
      }

      var forced = forceLeaseId && operation.leaseId === forceLeaseId;
      var belongsToActiveLease = activeLease && operation.leaseId === activeLease.leaseId;
      var operationLeaseActive = Number(operation.leaseExpiresAt) > now;
      if (!forced && belongsToActiveLease && operationLeaseActive) return;
      if (!forced && !belongsToActiveLease && operationLeaseActive && !activeLease) return;

      queueStore.put(toPending(
        operation,
        now,
        forced ? 'lease-released' : 'lease-expired'
      ));
      recovered++;
    });
    return recovered;
  }

  /**
   * Acquisisce il lease globale. Lo stesso worker puo rinnovarlo; un worker
   * differente riceve null finche il lease corrente non scade.
   */
  async function acquireLease(options) {
    options = options || {};
    var database = await ensureDatabase();
    var now = nowFrom(options);
    var ttlMs = clampInteger(
      options.ttlMs,
      DEFAULT_LEASE_MS,
      MIN_LEASE_MS,
      MAX_LEASE_MS
    );
    var workerId = normalizeWorkerId(options.workerId) || generateId();
    var requestedLeaseId = leaseIdFrom(options.leaseId);
    var transaction = database.transaction([QUEUE_STORE, META_STORE], 'readwrite');
    var completion = transactionComplete(transaction);
    var metaStore = transaction.objectStore(META_STORE);
    var queueStore = transaction.objectStore(QUEUE_STORE);
    var results = await Promise.all([
      requestResult(metaStore.get(STATE_KEY)),
      requestResult(metaStore.get(LEASE_KEY)),
      requestResult(queueStore.getAll())
    ]);
    var stateRecord = results[0];
    var currentLease = results[1];
    var operations = results[2];

    if (!stateHasAccount(stateRecord)) {
      await completion;
      throw createStateError(stateRecord);
    }

    if (isLeaseActive(currentLease, stateRecord, now)) {
      var sameLease = requestedLeaseId && requestedLeaseId === currentLease.leaseId;
      var sameWorker = currentLease.workerId === workerId;
      if (!sameLease && !sameWorker) {
        await completion;
        return null;
      }

      var renewedLease = {
        ...currentLease,
        workerId: workerId,
        renewedAt: now,
        expiresAt: now + ttlMs
      };
      metaStore.put(renewedLease);
      operations.forEach(function (operation) {
        if (operation && operation.status === 'sending' &&
            operation.ownerScope === stateRecord.ownerScope &&
            operation.leaseId === currentLease.leaseId) {
          queueStore.put({ ...operation, leaseExpiresAt: renewedLease.expiresAt });
        }
      });
      await completion;
      return renewedLease;
    }

    var recoveredCount = recoverOperations(
      queueStore,
      operations,
      stateRecord,
      null,
      now,
      null
    );
    var lease = {
      key: LEASE_KEY,
      leaseId: generateId(),
      workerId: workerId,
      ownerScope: stateRecord.ownerScope,
      accountId: stateRecord.accountId,
      acquiredAt: now,
      renewedAt: now,
      expiresAt: now + ttlMs
    };
    metaStore.put(lease);
    await completion;
    if (recoveredCount > 0) notifyQueueChanged('lease-recovered', true);
    return lease;
  }

  async function renewLease(leaseOrId, options) {
    options = options || {};
    var expectedLeaseId = leaseIdFrom(leaseOrId);
    if (!expectedLeaseId) return null;
    var database = await ensureDatabase();
    var now = nowFrom(options);
    var ttlMs = clampInteger(
      options.ttlMs,
      DEFAULT_LEASE_MS,
      MIN_LEASE_MS,
      MAX_LEASE_MS
    );
    var transaction = database.transaction([QUEUE_STORE, META_STORE], 'readwrite');
    var completion = transactionComplete(transaction);
    var metaStore = transaction.objectStore(META_STORE);
    var queueStore = transaction.objectStore(QUEUE_STORE);
    var results = await Promise.all([
      requestResult(metaStore.get(STATE_KEY)),
      requestResult(metaStore.get(LEASE_KEY)),
      requestResult(queueStore.getAll())
    ]);
    var stateRecord = results[0];
    var currentLease = results[1];
    var operations = results[2];

    if (!stateHasAccount(stateRecord) ||
        !isLeaseActive(currentLease, stateRecord, now) ||
        currentLease.leaseId !== expectedLeaseId) {
      await completion;
      return null;
    }

    var renewedLease = {
      ...currentLease,
      renewedAt: now,
      expiresAt: now + ttlMs
    };
    metaStore.put(renewedLease);
    operations.forEach(function (operation) {
      if (operation && operation.status === 'sending' &&
          operation.ownerScope === stateRecord.ownerScope &&
          operation.leaseId === expectedLeaseId) {
        queueStore.put({ ...operation, leaseExpiresAt: renewedLease.expiresAt });
      }
    });
    await completion;
    return renewedLease;
  }

  async function releaseLease(leaseOrId, options) {
    options = options || {};
    var expectedLeaseId = leaseIdFrom(leaseOrId);
    if (!expectedLeaseId) return false;
    var database = await ensureDatabase();
    var now = nowFrom(options);
    var transaction = database.transaction([QUEUE_STORE, META_STORE], 'readwrite');
    var completion = transactionComplete(transaction);
    var metaStore = transaction.objectStore(META_STORE);
    var queueStore = transaction.objectStore(QUEUE_STORE);
    var results = await Promise.all([
      requestResult(metaStore.get(STATE_KEY)),
      requestResult(metaStore.get(LEASE_KEY)),
      requestResult(queueStore.getAll())
    ]);
    var stateRecord = results[0];
    var currentLease = results[1];
    var operations = results[2];
    if (!stateIsPrepared(stateRecord) || !currentLease ||
        currentLease.leaseId !== expectedLeaseId) {
      await completion;
      return false;
    }

    var recoveredCount = 0;
    if (options.recoverClaimed !== false) {
      recoveredCount = recoverOperations(
        queueStore,
        operations,
        stateRecord,
        null,
        now,
        expectedLeaseId
      );
    }
    metaStore.delete(LEASE_KEY);
    await completion;
    notifyQueueChanged('lease-released', recoveredCount > 0);
    return true;
  }

  /**
   * Marca come sending al massimo `limit` operazioni pronte. L'incremento di
   * attempts e il controllo del lease avvengono nella stessa transazione.
   */
  async function claimBatch(leaseOrId, options) {
    options = options || {};
    var expectedLeaseId = leaseIdFrom(leaseOrId);
    if (!expectedLeaseId) return [];
    var database = await ensureDatabase();
    var now = nowFrom(options);
    var limit = clampInteger(
      options.limit,
      DEFAULT_BATCH_SIZE,
      1,
      MAX_BATCH_SIZE
    );
    var transaction = database.transaction([QUEUE_STORE, META_STORE, SHADOW_STORE], 'readwrite');
    var completion = transactionComplete(transaction);
    var metaStore = transaction.objectStore(META_STORE);
    var queueStore = transaction.objectStore(QUEUE_STORE);
    var results = await Promise.all([
      requestResult(metaStore.get(STATE_KEY)),
      requestResult(metaStore.get(LEASE_KEY)),
      requestResult(queueStore.getAll()),
      requestResult(transaction.objectStore(SHADOW_STORE).getAll())
    ]);
    var stateRecord = results[0];
    var currentLease = results[1];
    var operations = results[2];
    var shadows = new Map(results[3].map(function (record) {
      return [record.entityKey, record];
    }));
    if (!stateHasAccount(stateRecord) ||
        !isLeaseActive(currentLease, stateRecord, now) ||
        currentLease.leaseId !== expectedLeaseId) {
      await completion;
      return [];
    }

    recoverOperations(queueStore, operations, stateRecord, currentLease, now, null);
    var candidates = operations
      .filter(function (operation) {
        return operation &&
          operation.ownerScope === stateRecord.ownerScope &&
          operation.status === 'pending' &&
          (Number(operation.nextAttemptAt) || 0) <= now;
      })
      .sort(function (first, second) {
        return (Number(first.queuedAt) || 0) - (Number(second.queuedAt) || 0) ||
          first.entityKey.localeCompare(second.entityKey);
      })
      .slice(0, limit);

    var claimed = candidates.map(function (operation) {
      var shadow = shadows.get(operation.entityKey);
      if (shadow && shadow.ownerScope !== stateRecord.ownerScope) shadow = null;
      var storedBaseVersion = Number(operation.baseServerVersion);
      var shadowBaseVersion = shadow ? Number(shadow.serverVersion) : NaN;
      var previousAttempts = Number.isSafeInteger(Number(operation.attempts))
        ? Number(operation.attempts)
        : 0;
      var hasStoredBaseVersion = operation.baseServerVersion !== null &&
        operation.baseServerVersion !== undefined &&
        Number.isSafeInteger(storedBaseVersion) && storedBaseVersion >= 0;
      var claimedOperation = {
        ...operation,
        deviceId: stateRecord.localProfileId,
        // L'idempotenza RPC comprende anche la versione di base. Una volta
        // reclamata, deve restare invariata fino all'ack della stessa operationId:
        // lo shadow potrebbe essere gia avanzato se il browser e caduto fra
        // la risposta del server e la conferma della coda.
        baseServerVersion: hasStoredBaseVersion
          ? storedBaseVersion
          // Una vecchia operazione gia tentata con null deve conservare null,
          // perche anche quel valore fa parte dell'hash idempotente remoto.
          : (previousAttempts > 0
              ? null
              : (Number.isSafeInteger(shadowBaseVersion) && shadowBaseVersion >= 0
                  ? shadowBaseVersion
                  : 0)),
        status: 'sending',
        attempts: previousAttempts + 1,
        claimedAt: now,
        leaseId: currentLease.leaseId,
        leaseExpiresAt: currentLease.expiresAt,
        recoveryReason: null
      };
      queueStore.put(claimedOperation);
      return claimedOperation;
    });
    await completion;
    if (claimed.length > 0) notifyQueueChanged('queue-claimed', false);
    return claimed;
  }

  function normalizeReference(reference, requireLease) {
    if (!reference || typeof reference !== 'object') return null;
    var normalized = {
      entityKey: typeof reference.entityKey === 'string' ? reference.entityKey : null,
      operationId: typeof reference.operationId === 'string' ? reference.operationId : null,
      leaseId: typeof reference.leaseId === 'string' ? reference.leaseId : null
    };
    if (!normalized.entityKey || !normalized.operationId || (requireLease && !normalized.leaseId)) {
      return null;
    }
    return normalized;
  }

  function operationMatches(record, reference, requireSending) {
    return Boolean(
      record &&
      record.operationId === reference.operationId &&
      (!reference.leaseId || record.leaseId === reference.leaseId) &&
      (!requireSending || record.status === 'sending')
    );
  }

  async function acknowledgeBatch(references) {
    var normalizedReferences = Array.from(references || [])
      .map(function (reference) { return normalizeReference(reference, true); })
      .filter(Boolean);
    if (normalizedReferences.length === 0) {
      return { acknowledged: [], stale: [] };
    }

    // Una chiave puo rappresentare una sola operazione: conserva l'ultima
    // referenza ricevuta per evitare due delete nella stessa transazione.
    var uniqueReferences = Array.from(new Map(
      normalizedReferences.map(function (reference) {
        return [reference.entityKey, reference];
      })
    ).values());
    var database = await ensureDatabase();
    var transaction = database.transaction(QUEUE_STORE, 'readwrite');
    var completion = transactionComplete(transaction);
    var queueStore = transaction.objectStore(QUEUE_STORE);
    var records = await Promise.all(uniqueReferences.map(function (reference) {
      return requestResult(queueStore.get(reference.entityKey));
    }));
    var acknowledged = [];
    var stale = [];
    uniqueReferences.forEach(function (reference, index) {
      if (operationMatches(records[index], reference, true)) {
        queueStore.delete(reference.entityKey);
        acknowledged.push(reference);
      } else {
        stale.push(reference);
      }
    });
    await completion;
    if (acknowledged.length > 0) notifyQueueChanged('queue-acknowledged', false);
    return { acknowledged: acknowledged, stale: stale };
  }

  async function acknowledge(reference) {
    var result = await acknowledgeBatch([reference]);
    return result.acknowledged.length === 1;
  }

  function normalizeError(error, now) {
    if (!error) return null;
    var message = typeof error === 'string'
      ? error
      : (typeof error.message === 'string' ? error.message : String(error));
    var result = {
      message: message.slice(0, 500),
      at: now
    };
    if (error && typeof error === 'object') {
      if (error.code !== undefined) result.code = String(error.code).slice(0, 100);
      if (Number.isFinite(Number(error.status))) result.status = Number(error.status);
    }
    return result;
  }

  function retryDelay(operation, options) {
    if (options && Number.isFinite(Number(options.retryAfterMs))) {
      return clampInteger(options.retryAfterMs, 0, 0, MAX_RETRY_MS);
    }
    var attempts = Math.max(1, Number(operation.attempts) || 1);
    var exponential = Math.min(
      MAX_RETRY_MS,
      DEFAULT_RETRY_MS * Math.pow(2, Math.min(attempts - 1, 10))
    );
    var jitter = 0.8 + (Math.random() * 0.4);
    return Math.round(exponential * jitter);
  }

  async function updateClaimed(reference, options, updater) {
    var normalizedReference = normalizeReference(reference, true);
    if (!normalizedReference) return null;
    var database = await ensureDatabase();
    var transaction = database.transaction(QUEUE_STORE, 'readwrite');
    var completion = transactionComplete(transaction);
    var queueStore = transaction.objectStore(QUEUE_STORE);
    var record = await requestResult(queueStore.get(normalizedReference.entityKey));
    if (!operationMatches(record, normalizedReference, true)) {
      await completion;
      return null;
    }
    var updated = updater(record, nowFrom(options), options || {});
    queueStore.put(updated);
    await completion;
    return updated;
  }

  async function retry(reference, options) {
    var updated = await updateClaimed(reference, options, function (operation, now, retryOptions) {
      var delay = retryDelay(operation, retryOptions);
      return {
        ...operation,
        status: 'pending',
        nextAttemptAt: now + delay,
        leaseId: null,
        leaseExpiresAt: null,
        claimedAt: null,
        lastAttemptAt: now,
        lastError: normalizeError(retryOptions.error, now)
      };
    });
    if (updated) notifyQueueChanged('queue-retry-scheduled', true);
    return updated;
  }

  /**
   * Sostituisce l'operationId dopo un conflitto server. Un operationId remoto
   * e immutabile: riutilizzarlo con una nuova versione di base violerebbe
   * l'idempotenza della RPC e bloccherebbe definitivamente la coda.
   */
  async function rebase(reference, options) {
    var updated = await updateClaimed(reference, options, function (operation, now, rebaseOptions) {
      return {
        ...operation,
        operationId: generateId(),
        baseServerVersion: null,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now + retryDelay(operation, rebaseOptions),
        leaseId: null,
        leaseExpiresAt: null,
        claimedAt: null,
        blockedAt: null,
        lastAttemptAt: now,
        lastError: normalizeError(rebaseOptions.error, now),
        recoveryReason: 'server-conflict'
      };
    });
    if (updated) notifyQueueChanged('queue-rebased', true);
    return updated;
  }

  async function block(reference, options) {
    var updated = await updateClaimed(reference, options, function (operation, now, blockOptions) {
      return {
        ...operation,
        status: 'blocked',
        nextAttemptAt: 0,
        leaseId: null,
        leaseExpiresAt: null,
        claimedAt: null,
        blockedAt: now,
        lastAttemptAt: now,
        lastError: normalizeError(blockOptions.error, now)
      };
    });
    if (updated) notifyQueueChanged('queue-blocked', false);
    return updated;
  }

  async function retryBlocked(reference, options) {
    var normalizedReference = normalizeReference(reference, false);
    if (!normalizedReference) return null;
    var database = await ensureDatabase();
    var transaction = database.transaction(QUEUE_STORE, 'readwrite');
    var completion = transactionComplete(transaction);
    var queueStore = transaction.objectStore(QUEUE_STORE);
    var record = await requestResult(queueStore.get(normalizedReference.entityKey));
    if (!record || record.operationId !== normalizedReference.operationId ||
        record.status !== 'blocked') {
      await completion;
      return null;
    }
    var now = nowFrom(options);
    var updated = {
      ...record,
      status: 'pending',
      nextAttemptAt: now,
      blockedAt: null,
      lastError: null
    };
    queueStore.put(updated);
    await completion;
    notifyQueueChanged('blocked-operation-retried', true);
    return updated;
  }

  async function recoverExpired(options) {
    options = options || {};
    var database = await ensureDatabase();
    var now = nowFrom(options);
    var transaction = database.transaction([QUEUE_STORE, META_STORE], 'readwrite');
    var completion = transactionComplete(transaction);
    var metaStore = transaction.objectStore(META_STORE);
    var queueStore = transaction.objectStore(QUEUE_STORE);
    var results = await Promise.all([
      requestResult(metaStore.get(STATE_KEY)),
      requestResult(metaStore.get(LEASE_KEY)),
      requestResult(queueStore.getAll())
    ]);
    var stateRecord = results[0];
    var currentLease = results[1];
    var operations = results[2];
    if (!stateIsPrepared(stateRecord)) {
      await completion;
      return { recoveredCount: 0, leaseCleared: false };
    }

    var activeLease = isLeaseActive(currentLease, stateRecord, now)
      ? currentLease
      : null;
    var recoveredCount = recoverOperations(
      queueStore,
      operations,
      stateRecord,
      activeLease,
      now,
      null
    );
    var leaseCleared = Boolean(currentLease && !activeLease);
    if (leaseCleared) metaStore.delete(LEASE_KEY);
    await completion;
    if (recoveredCount > 0) notifyQueueChanged('expired-operation-recovered', true);
    return { recoveredCount: recoveredCount, leaseCleared: leaseCleared };
  }

  async function getStats(options) {
    var database = await ensureDatabase();
    var now = nowFrom(options || {});
    var transaction = database.transaction([QUEUE_STORE, META_STORE], 'readonly');
    var results = await Promise.all([
      requestResult(transaction.objectStore(META_STORE).get(STATE_KEY)),
      requestResult(transaction.objectStore(META_STORE).get(LEASE_KEY)),
      requestResult(transaction.objectStore(QUEUE_STORE).getAll())
    ]);
    var stateRecord = results[0];
    var currentLease = results[1];
    var owned = results[2].filter(function (operation) {
      return stateRecord && operation && operation.ownerScope === stateRecord.ownerScope;
    });
    var countStatus = function (status) {
      return owned.filter(function (operation) { return operation.status === status; }).length;
    };
    var pendingAttempts = owned
      .filter(function (operation) { return operation.status === 'pending'; })
      .map(function (operation) { return Math.max(0, Number(operation.nextAttemptAt) || 0); });
    return {
      accountId: stateRecord && stateRecord.accountId ? stateRecord.accountId : null,
      ownerScope: stateRecord && stateRecord.ownerScope ? stateRecord.ownerScope : null,
      totalCount: owned.length,
      pendingCount: countStatus('pending'),
      dueCount: owned.filter(function (operation) {
        return operation.status === 'pending' && (Number(operation.nextAttemptAt) || 0) <= now;
      }).length,
      nextAttemptAt: pendingAttempts.length > 0 ? Math.min.apply(Math, pendingAttempts) : null,
      sendingCount: countStatus('sending'),
      blockedCount: countStatus('blocked'),
      leaseActive: Boolean(stateRecord && isLeaseActive(currentLease, stateRecord, now)),
      leaseExpiresAt: stateRecord && isLeaseActive(currentLease, stateRecord, now)
        ? Number(currentLease.expiresAt)
        : null
    };
  }

  async function bindAccount(accountId) {
    if (!window.SyncPreparation || typeof window.SyncPreparation.bindAccount !== 'function') {
      throw new Error('Preparazione della sincronizzazione non disponibile');
    }
    return window.SyncPreparation.bindAccount(accountId);
  }

  async function getAccountBinding() {
    if (!window.SyncPreparation ||
        typeof window.SyncPreparation.getAccountBinding !== 'function') {
      throw new Error('Preparazione della sincronizzazione non disponibile');
    }
    return window.SyncPreparation.getAccountBinding();
  }

  window.SyncQueue = {
    DEFAULT_BATCH_SIZE: DEFAULT_BATCH_SIZE,
    DEFAULT_LEASE_MS: DEFAULT_LEASE_MS,
    MAX_BATCH_SIZE: MAX_BATCH_SIZE,
    acquireLease: acquireLease,
    renewLease: renewLease,
    releaseLease: releaseLease,
    claimBatch: claimBatch,
    acknowledge: acknowledge,
    acknowledgeBatch: acknowledgeBatch,
    retry: retry,
    rebase: rebase,
    block: block,
    retryBlocked: retryBlocked,
    recoverExpired: recoverExpired,
    getStats: getStats,
    bindAccount: bindAccount,
    getAccountBinding: getAccountBinding
  };
})();
