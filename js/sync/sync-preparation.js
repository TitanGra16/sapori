/**
 * Preparazione locale della sincronizzazione di Sapori.
 *
 * Questo modulo non effettua richieste di rete: conserva soltanto riferimenti
 * leggeri alle entità modificate. Un futuro adattatore cloud potrà leggere il
 * valore più recente dagli archivi recipes, images e settings.
 */
(function () {
  'use strict';

  var QUEUE_STORE = 'syncQueue';
  var META_STORE = 'syncMeta';
  var SHADOW_STORE = 'syncShadow';
  var CONFLICTS_STORE = 'syncConflicts';
  var STATE_KEY = 'state';
  var LOCAL_SCOPE_PREFIX = 'locale:';
  var CHANNEL_NAME = 'sapori-sync-state';
  var coordinationChannel = null;
  var state = {
    intentEnabled: false,
    localProfileId: null,
    ownerScope: null,
    accountId: null,
    accountBoundAt: null,
    preparedAt: null,
    queueKeyVersion: 2,
    queueSchemaVersion: 2
  };

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
        reject(transaction.error || new Error('Transazione di sincronizzazione annullata'));
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

  function normalizeState(record) {
    if (!record || record.key !== STATE_KEY) {
      return {
        intentEnabled: false,
        localProfileId: null,
        ownerScope: null,
        accountId: null,
        accountBoundAt: null,
        preparedAt: null,
        queueKeyVersion: 2,
        queueSchemaVersion: 2
      };
    }

    var localProfileId = typeof record.localProfileId === 'string' && record.localProfileId
      ? record.localProfileId
      : null;
    var ownerScope = typeof record.ownerScope === 'string' && record.ownerScope
      ? record.ownerScope
      : (localProfileId ? LOCAL_SCOPE_PREFIX + localProfileId : null);

    return {
      intentEnabled: record.intentEnabled === true && Boolean(localProfileId && ownerScope),
      localProfileId: localProfileId,
      ownerScope: ownerScope,
      accountId: typeof record.accountId === 'string' && record.accountId ? record.accountId : null,
      accountBoundAt: Number.isFinite(Number(record.accountBoundAt))
        ? Number(record.accountBoundAt)
        : null,
      preparedAt: Number.isFinite(Number(record.preparedAt)) ? Number(record.preparedAt) : null,
      queueKeyVersion: Number(record.queueKeyVersion) >= 2 ? 2 : 1,
      queueSchemaVersion: Number(record.queueSchemaVersion) >= 2 ? 2 : 1
    };
  }

  function setupCoordinationChannel() {
    if (coordinationChannel || typeof window.BroadcastChannel !== 'function') return;
    coordinationChannel = new window.BroadcastChannel(CHANNEL_NAME);
    coordinationChannel.addEventListener('message', function (event) {
      if (!event.data || event.data.type !== 'sync-state') return;
      state = normalizeState(event.data.state);
    });
  }

  function publishState() {
    setupCoordinationChannel();
    if (!coordinationChannel) return;
    coordinationChannel.postMessage({
      type: 'sync-state',
      state: {
        key: STATE_KEY,
        intentEnabled: state.intentEnabled,
        localProfileId: state.localProfileId,
        ownerScope: state.ownerScope,
        accountId: state.accountId,
        accountBoundAt: state.accountBoundAt,
        preparedAt: state.preparedAt,
        queueKeyVersion: state.queueKeyVersion,
        queueSchemaVersion: state.queueSchemaVersion
      }
    });
  }

  function ensureIndex(store, name, keyPath) {
    if (!store.indexNames.contains(name)) {
      store.createIndex(name, keyPath, { unique: false });
    }
  }

  function installStores(database, upgradeTransaction) {
    var queueStore;
    if (!database.objectStoreNames.contains(QUEUE_STORE)) {
      queueStore = database.createObjectStore(QUEUE_STORE, { keyPath: 'entityKey' });
    } else if (upgradeTransaction) {
      queueStore = upgradeTransaction.objectStore(QUEUE_STORE);
    }

    if (queueStore) {
      ensureIndex(queueStore, 'queuedAt', 'queuedAt');
      ensureIndex(queueStore, 'entityType', 'entityType');
      ensureIndex(queueStore, 'statusNext', ['status', 'nextAttemptAt']);
      ensureIndex(queueStore, 'ownerScope', 'ownerScope');
      ensureIndex(queueStore, 'ownerStatusNext', ['ownerScope', 'status', 'nextAttemptAt']);
      ensureIndex(queueStore, 'leaseExpiresAt', 'leaseExpiresAt');
      ensureIndex(queueStore, 'operationId', 'operationId');
    }

    if (!database.objectStoreNames.contains(META_STORE)) {
      database.createObjectStore(META_STORE, { keyPath: 'key' });
    }

    if (!database.objectStoreNames.contains(SHADOW_STORE)) {
      var shadowStore = database.createObjectStore(SHADOW_STORE, { keyPath: 'entityKey' });
      shadowStore.createIndex('ownerScope', 'ownerScope', { unique: false });
      shadowStore.createIndex('serverRevision', 'serverRevision', { unique: false });
    }

    if (!database.objectStoreNames.contains(CONFLICTS_STORE)) {
      var conflictsStore = database.createObjectStore(CONFLICTS_STORE, { keyPath: 'id' });
      conflictsStore.createIndex('ownerScope', 'ownerScope', { unique: false });
      conflictsStore.createIndex('createdAt', 'createdAt', { unique: false });
      conflictsStore.createIndex('status', 'status', { unique: false });
    }
  }

  async function hydrate(database) {
    if (!database ||
        !database.objectStoreNames.contains(META_STORE) ||
        !database.objectStoreNames.contains(QUEUE_STORE)) {
      reset();
      return;
    }

    setupCoordinationChannel();
    var transaction = database.transaction([META_STORE, QUEUE_STORE], 'readwrite');
    var completion = transactionComplete(transaction);
    var metaStore = transaction.objectStore(META_STORE);
    var record = await requestResult(metaStore.get(STATE_KEY));
    state = normalizeState(record);
    if (!record || (state.queueKeyVersion >= 2 && state.queueSchemaVersion >= 2)) {
      await completion;
      return;
    }

    // Le prime versioni della coda non includevano ownerScope nella chiave.
    // Migra in-place così profili diversi non possono sovrascriversi.
    var queueStore = transaction.objectStore(QUEUE_STORE);
    var operations = await requestResult(queueStore.getAll());
    operations.forEach(function (operation) {
      if (!operation) return;
      var operationOwner = operation.ownerScope || state.ownerScope;
      if (!operationOwner || !operation.entityType || !operation.entityId || !operation.channel) {
        return;
      }
      var scopedKey = entityKey(
        operationOwner,
        operation.entityType,
        operation.entityId,
        operation.channel
      );
      var status = operation.status === 'blocked' ? 'blocked' : operation.status;
      var hasValidLease = status === 'sending' &&
        typeof operation.leaseId === 'string' && operation.leaseId &&
        Number.isFinite(Number(operation.leaseExpiresAt));
      if (status !== 'pending' && status !== 'blocked' && !hasValidLease) {
        status = 'pending';
      }
      var normalizedOperation = {
        ...operation,
        entityKey: scopedKey,
        ownerScope: operationOwner,
        status: status,
        attempts: Number.isSafeInteger(Number(operation.attempts)) && Number(operation.attempts) >= 0
          ? Number(operation.attempts)
          : 0,
        nextAttemptAt: Number.isFinite(Number(operation.nextAttemptAt))
          ? Math.max(0, Number(operation.nextAttemptAt))
          : 0,
        leaseId: hasValidLease ? operation.leaseId : null,
        leaseExpiresAt: hasValidLease ? Number(operation.leaseExpiresAt) : null,
        claimedAt: hasValidLease && Number.isFinite(Number(operation.claimedAt))
          ? Number(operation.claimedAt)
          : null,
        blockedAt: status === 'blocked' && Number.isFinite(Number(operation.blockedAt))
          ? Number(operation.blockedAt)
          : null,
        queueSchemaVersion: 2
      };
      if (operation.entityKey !== scopedKey) queueStore.delete(operation.entityKey);
      queueStore.put(normalizedOperation);
    });
    var migratedState = {
      ...record,
      queueKeyVersion: 2,
      queueSchemaVersion: 2,
      accountBoundAt: state.accountId
        ? (state.accountBoundAt || Number(record.updatedAt) || state.preparedAt || Date.now())
        : null,
      updatedAt: Date.now()
    };
    metaStore.put(migratedState);
    state = normalizeState(migratedState);
    await completion;
  }

  function reset() {
    state = normalizeState(null);
  }

  function isPrepared() {
    return state.intentEnabled === true;
  }

  function withQueue(storeNames) {
    var names = Array.isArray(storeNames) ? storeNames.slice() : [storeNames];
    // La decisione di accodare viene presa da syncMeta nella medesima
    // transazione della modifica, non dallo stato in memoria della scheda.
    if (names.indexOf(QUEUE_STORE) === -1) names.push(QUEUE_STORE);
    if (names.indexOf(META_STORE) === -1) names.push(META_STORE);
    return names;
  }

  function entityKey(ownerScope, entityType, entityId, channel) {
    return ownerScope + '|' + entityType + ':' + entityId + ':' + channel;
  }

  function buildOperation(entityType, entityId, channel, action, changedAt, ownerScope) {
    var timestamp = Number.isFinite(Number(changedAt)) ? Number(changedAt) : Date.now();
    var operationOwner = ownerScope || state.ownerScope;
    return {
      entityKey: entityKey(operationOwner, entityType, entityId, channel),
      operationId: generateId(),
      entityType: entityType,
      entityId: String(entityId),
      channel: channel,
      action: action,
      ownerScope: operationOwner,
      baseServerVersion: null,
      queuedAt: timestamp,
      updatedAt: timestamp,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      leaseId: null,
      leaseExpiresAt: null,
      claimedAt: null,
      blockedAt: null,
      queueSchemaVersion: 2
    };
  }

  function withTransactionState(transaction, callback) {
    if (!transaction.objectStoreNames.contains(QUEUE_STORE) ||
        !transaction.objectStoreNames.contains(META_STORE)) {
      throw new Error('La modifica locale non può essere registrata nella coda');
    }

    var request = transaction.objectStore(META_STORE).get(STATE_KEY);
    request.onsuccess = function () {
      var transactionState = normalizeState(request.result);
      if (!transactionState.intentEnabled) return;
      state = transactionState;
      callback(transaction.objectStore(QUEUE_STORE), transactionState);
    };
    return true;
  }

  function queueOperation(transaction, entityType, entityId, channel, action, changedAt) {
    return withTransactionState(transaction, function (queueStore, transactionState) {
      queueStore.put(
        buildOperation(
          entityType,
          entityId,
          channel,
          action,
          changedAt,
          transactionState.ownerScope
        )
      );
    });
  }

  function queueRecipeContent(transaction, recipeId, changedAt) {
    return queueOperation(transaction, 'recipe', recipeId, 'content', 'upsert', changedAt);
  }

  function queueRecipeFavorite(transaction, recipeId, changedAt) {
    return queueOperation(transaction, 'recipe', recipeId, 'favorite', 'set', changedAt);
  }

  function queueRecipeImage(transaction, recipeId, hasImage, changedAt) {
    return queueOperation(
      transaction,
      'recipe',
      recipeId,
      'image',
      hasImage ? 'upsert' : 'delete',
      changedAt
    );
  }

  function queueCategories(transaction, changedAt) {
    return queueOperation(transaction, 'settings', 'customCategories', 'categories', 'upsert', changedAt);
  }

  function queueRecipeDelete(transaction, recipeId, changedAt) {
    return withTransactionState(transaction, function (queueStore, transactionState) {
      var ownerScope = transactionState.ownerScope;
      queueStore.delete(entityKey(ownerScope, 'recipe', recipeId, 'favorite'));
      queueStore.delete(entityKey(ownerScope, 'recipe', recipeId, 'image'));
      queueStore.delete('recipe:' + recipeId + ':favorite');
      queueStore.delete('recipe:' + recipeId + ':image');
      queueStore.put(
        buildOperation('recipe', recipeId, 'content', 'delete', changedAt, ownerScope)
      );
    });
  }

  async function prepareDevice() {
    if (!window.DB) throw new Error('Archivio locale non disponibile');
    var database = await window.DB._ensureDB();

    var transaction = database.transaction(
      ['recipes', QUEUE_STORE, META_STORE],
      'readwrite'
    );
    var completion = transactionComplete(transaction);
    var results = await Promise.all([
      requestResult(transaction.objectStore(META_STORE).get(STATE_KEY)),
      requestResult(transaction.objectStore('recipes').getAll()),
      requestResult(transaction.objectStore(QUEUE_STORE).getAll())
    ]);
    var persistedState = normalizeState(results[0]);
    var recipes = results[1];
    var queuedOperations = results[2];
    if (persistedState.intentEnabled) {
      await completion;
      state = persistedState;
      publishState();
      return getStatus();
    }

    var now = Date.now();
    var localProfileId = persistedState.localProfileId || generateId();
    var ownerScope = persistedState.ownerScope || (LOCAL_SCOPE_PREFIX + localProfileId);
    var preparedState = {
      key: STATE_KEY,
      intentEnabled: true,
      localProfileId: localProfileId,
      ownerScope: ownerScope,
      accountId: null,
      accountBoundAt: null,
      preparedAt: persistedState.preparedAt || now,
      queueKeyVersion: 2,
      queueSchemaVersion: 2,
      updatedAt: now
    };
    var queueStore = transaction.objectStore(QUEUE_STORE);

    // Ricostruisce soltanto lo scope di questo profilo. Eventuali record di un
    // altro scope vengono conservati per evitare una cancellazione globale in
    // presenza di metadati legacy o parzialmente danneggiati.
    queuedOperations.forEach(function (operation) {
      if (!operation || !operation.ownerScope || operation.ownerScope === ownerScope) {
        if (operation && operation.entityKey) queueStore.delete(operation.entityKey);
      }
    });
    recipes.forEach(function (recipe) {
      queueStore.put(buildOperation('recipe', recipe.id, 'content', 'upsert', now, ownerScope));
      queueStore.put(buildOperation('recipe', recipe.id, 'favorite', 'set', now, ownerScope));
      if (recipe.hasImage) {
        queueStore.put(buildOperation('recipe', recipe.id, 'image', 'upsert', now, ownerScope));
      }
    });
    queueStore.put(
      buildOperation('settings', 'customCategories', 'categories', 'upsert', now, ownerScope)
    );
    transaction.objectStore(META_STORE).put(preparedState);

    await completion;
    state = normalizeState(preparedState);
    publishState();
    return getStatus();
  }

  function normalizeAccountId(accountId) {
    if (typeof accountId !== 'string') return null;
    var normalized = accountId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
      return null;
    }
    return normalized;
  }

  /**
   * Associa il profilo locale a un account remoto senza cambiare ownerScope o
   * le chiavi gia presenti nella coda. Il logout non deve rimuovere questo
   * vincolo: impedisce di fondere per errore due account nello stesso archivio.
   */
  async function bindAccount(accountId) {
    var normalizedAccountId = normalizeAccountId(accountId);
    if (!normalizedAccountId) {
      var invalidError = new Error('Identificativo account non valido');
      invalidError.code = 'SYNC_INVALID_ACCOUNT';
      throw invalidError;
    }
    if (!window.DB) throw new Error('Archivio locale non disponibile');

    var database = await window.DB._ensureDB();
    var transaction = database.transaction(META_STORE, 'readwrite');
    var completion = transactionComplete(transaction);
    var metaStore = transaction.objectStore(META_STORE);
    var record = await requestResult(metaStore.get(STATE_KEY));
    var persistedState = normalizeState(record);

    if (!persistedState.intentEnabled) {
      await completion;
      var preparationError = new Error('Attiva prima la preparazione della sincronizzazione');
      preparationError.code = 'SYNC_NOT_PREPARED';
      throw preparationError;
    }
    if (persistedState.accountId && persistedState.accountId !== normalizedAccountId) {
      await completion;
      var mismatchError = new Error('Questo archivio locale appartiene a un altro account');
      mismatchError.code = 'SYNC_ACCOUNT_MISMATCH';
      mismatchError.accountId = persistedState.accountId;
      throw mismatchError;
    }

    var now = Date.now();
    var boundState = {
      ...(record || {}),
      key: STATE_KEY,
      intentEnabled: true,
      localProfileId: persistedState.localProfileId,
      ownerScope: persistedState.ownerScope,
      accountId: normalizedAccountId,
      accountBoundAt: persistedState.accountBoundAt || now,
      preparedAt: persistedState.preparedAt,
      queueKeyVersion: 2,
      queueSchemaVersion: 2,
      updatedAt: now
    };
    metaStore.put(boundState);
    await completion;
    state = normalizeState(boundState);
    publishState();

    return {
      accountId: state.accountId,
      accountBoundAt: state.accountBoundAt,
      localProfileId: state.localProfileId,
      ownerScope: state.ownerScope
    };
  }

  async function getAccountBinding() {
    if (!window.DB) throw new Error('Archivio locale non disponibile');
    var database = await window.DB._ensureDB();
    var transaction = database.transaction(META_STORE, 'readonly');
    var record = await requestResult(transaction.objectStore(META_STORE).get(STATE_KEY));
    state = normalizeState(record);
    return {
      accountId: state.accountId,
      accountBoundAt: state.accountBoundAt,
      localProfileId: state.localProfileId,
      ownerScope: state.ownerScope,
      preparationEnabled: state.intentEnabled
    };
  }

  async function getStatus() {
    if (!window.DB) throw new Error('Archivio locale non disponibile');
    var database = await window.DB._ensureDB();
    var transaction = database.transaction(
      ['recipes', QUEUE_STORE, META_STORE],
      'readonly'
    );
    var results = await Promise.all([
      requestResult(transaction.objectStore('recipes').count()),
      requestResult(transaction.objectStore(QUEUE_STORE).getAll()),
      requestResult(transaction.objectStore(META_STORE).get(STATE_KEY))
    ]);
    var recipeCount = results[0];
    var operations = results[1];
    state = normalizeState(results[2]);

    var ownedOperations = operations.filter(function (operation) {
      return operation.ownerScope === state.ownerScope;
    });
    var pendingOperations = ownedOperations.filter(function (operation) {
      return operation.status === 'pending';
    });
    var sendingOperations = ownedOperations.filter(function (operation) {
      return operation.status === 'sending';
    });
    var blockedOperations = ownedOperations.filter(function (operation) {
      return operation.status === 'blocked';
    });
    var pendingRecipeIds = new Set(
      ownedOperations
        .filter(function (operation) { return operation.entityType === 'recipe'; })
        .map(function (operation) { return operation.entityId; })
    );
    var lastQueuedAt = ownedOperations.reduce(function (latest, operation) {
      return Math.max(latest, Number(operation.updatedAt) || 0);
    }, 0);

    return {
      state: state.intentEnabled ? 'ready' : 'not-prepared',
      preparationEnabled: state.intentEnabled,
      cloudConnected: false,
      accountConnected: Boolean(state.accountId),
      accountId: state.accountId,
      accountBoundAt: state.accountBoundAt,
      localProfileId: state.localProfileId,
      ownerScope: state.ownerScope,
      preparedAt: state.preparedAt,
      recipeCount: recipeCount,
      pendingCount: ownedOperations.length,
      readyCount: pendingOperations.length,
      sendingCount: sendingOperations.length,
      blockedCount: blockedOperations.length,
      pendingRecipeCount: pendingRecipeIds.size,
      lastQueuedAt: lastQueuedAt || null
    };
  }

  async function getPendingChanges(limit) {
    if (!window.DB) throw new Error('Archivio locale non disponibile');
    var database = await window.DB._ensureDB();
    var transaction = database.transaction([QUEUE_STORE, META_STORE], 'readonly');
    var results = await Promise.all([
      requestResult(transaction.objectStore(QUEUE_STORE).getAll()),
      requestResult(transaction.objectStore(META_STORE).get(STATE_KEY))
    ]);
    var operations = results[0];
    state = normalizeState(results[1]);
    var maximum = Number.isInteger(limit) && limit >= 0 ? limit : operations.length;

    return operations
      .filter(function (operation) {
        return operation.status === 'pending' &&
          (!state.ownerScope || operation.ownerScope === state.ownerScope);
      })
      .sort(function (first, second) {
        return first.queuedAt - second.queuedAt ||
          first.entityKey.localeCompare(second.entityKey);
      })
      .slice(0, maximum);
  }

  window.SyncPreparation = {
    QUEUE_STORE: QUEUE_STORE,
    META_STORE: META_STORE,
    SHADOW_STORE: SHADOW_STORE,
    CONFLICTS_STORE: CONFLICTS_STORE,
    installStores: installStores,
    hydrate: hydrate,
    reset: reset,
    isPrepared: isPrepared,
    withQueue: withQueue,
    prepareDevice: prepareDevice,
    bindAccount: bindAccount,
    getAccountBinding: getAccountBinding,
    getStatus: getStatus,
    getPendingChanges: getPendingChanges,
    queueRecipeContent: queueRecipeContent,
    queueRecipeFavorite: queueRecipeFavorite,
    queueRecipeImage: queueRecipeImage,
    queueRecipeDelete: queueRecipeDelete,
    queueCategories: queueCategories
  };
})();
