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
  var STATE_KEY = 'state';
  var LOCAL_SCOPE_PREFIX = 'locale:';
  var state = {
    intentEnabled: false,
    localProfileId: null,
    ownerScope: null,
    accountId: null,
    preparedAt: null
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
        preparedAt: null
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
      preparedAt: Number.isFinite(Number(record.preparedAt)) ? Number(record.preparedAt) : null
    };
  }

  function installStores(database) {
    if (!database.objectStoreNames.contains(QUEUE_STORE)) {
      var queueStore = database.createObjectStore(QUEUE_STORE, { keyPath: 'entityKey' });
      queueStore.createIndex('queuedAt', 'queuedAt', { unique: false });
      queueStore.createIndex('entityType', 'entityType', { unique: false });
      queueStore.createIndex('statusNext', ['status', 'nextAttemptAt'], { unique: false });
      queueStore.createIndex('ownerScope', 'ownerScope', { unique: false });
    }

    if (!database.objectStoreNames.contains(META_STORE)) {
      database.createObjectStore(META_STORE, { keyPath: 'key' });
    }
  }

  async function hydrate(database) {
    if (!database ||
        !database.objectStoreNames.contains(META_STORE) ||
        !database.objectStoreNames.contains(QUEUE_STORE)) {
      reset();
      return;
    }

    var transaction = database.transaction(META_STORE, 'readonly');
    var record = await requestResult(transaction.objectStore(META_STORE).get(STATE_KEY));
    state = normalizeState(record);
  }

  function reset() {
    state = normalizeState(null);
  }

  function isPrepared() {
    return state.intentEnabled === true;
  }

  function withQueue(storeNames) {
    var names = Array.isArray(storeNames) ? storeNames.slice() : [storeNames];
    if (isPrepared() && names.indexOf(QUEUE_STORE) === -1) names.push(QUEUE_STORE);
    return names;
  }

  function entityKey(entityType, entityId, channel) {
    return entityType + ':' + entityId + ':' + channel;
  }

  function buildOperation(entityType, entityId, channel, action, changedAt, ownerScope) {
    var timestamp = Number.isFinite(Number(changedAt)) ? Number(changedAt) : Date.now();
    return {
      entityKey: entityKey(entityType, entityId, channel),
      operationId: generateId(),
      entityType: entityType,
      entityId: String(entityId),
      channel: channel,
      action: action,
      ownerScope: ownerScope || state.ownerScope,
      baseServerVersion: null,
      queuedAt: timestamp,
      updatedAt: timestamp,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null
    };
  }

  function queueOperation(transaction, entityType, entityId, channel, action, changedAt) {
    if (!isPrepared()) return false;
    if (!transaction.objectStoreNames.contains(QUEUE_STORE)) {
      throw new Error('La modifica locale non può essere registrata nella coda');
    }

    transaction.objectStore(QUEUE_STORE).put(
      buildOperation(entityType, entityId, channel, action, changedAt)
    );
    return true;
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
    if (!isPrepared()) return false;
    if (!transaction.objectStoreNames.contains(QUEUE_STORE)) {
      throw new Error('La cancellazione locale non può essere registrata nella coda');
    }

    var queueStore = transaction.objectStore(QUEUE_STORE);
    queueStore.delete(entityKey('recipe', recipeId, 'favorite'));
    queueStore.delete(entityKey('recipe', recipeId, 'image'));
    queueStore.put(buildOperation('recipe', recipeId, 'content', 'delete', changedAt));
    return true;
  }

  async function prepareDevice() {
    if (!window.DB) throw new Error('Archivio locale non disponibile');
    var database = await window.DB._ensureDB();
    if (isPrepared()) return getStatus();

    var transaction = database.transaction(
      ['recipes', QUEUE_STORE, META_STORE],
      'readwrite'
    );
    var completion = transactionComplete(transaction);
    var recipes = await requestResult(transaction.objectStore('recipes').getAll());
    var now = Date.now();
    var localProfileId = state.localProfileId || generateId();
    var ownerScope = state.ownerScope || (LOCAL_SCOPE_PREFIX + localProfileId);
    var preparedState = {
      key: STATE_KEY,
      intentEnabled: true,
      localProfileId: localProfileId,
      ownerScope: ownerScope,
      accountId: null,
      preparedAt: state.preparedAt || now,
      updatedAt: now
    };
    var queueStore = transaction.objectStore(QUEUE_STORE);

    // Non esiste ancora un cloud: una nuova preparazione ricostruisce una
    // fotografia coerente dello stato corrente e rimuove riferimenti obsoleti.
    queueStore.clear();
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
    return getStatus();
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

    var pendingOperations = operations.filter(function (operation) {
      return operation.status === 'pending' && operation.ownerScope === state.ownerScope;
    });
    var pendingRecipeIds = new Set(
      pendingOperations
        .filter(function (operation) { return operation.entityType === 'recipe'; })
        .map(function (operation) { return operation.entityId; })
    );
    var lastQueuedAt = pendingOperations.reduce(function (latest, operation) {
      return Math.max(latest, Number(operation.updatedAt) || 0);
    }, 0);

    return {
      state: state.intentEnabled ? 'ready' : 'not-prepared',
      preparationEnabled: state.intentEnabled,
      cloudConnected: false,
      accountConnected: false,
      accountId: state.accountId,
      localProfileId: state.localProfileId,
      ownerScope: state.ownerScope,
      preparedAt: state.preparedAt,
      recipeCount: recipeCount,
      pendingCount: pendingOperations.length,
      pendingRecipeCount: pendingRecipeIds.size,
      lastQueuedAt: lastQueuedAt || null
    };
  }

  async function getPendingChanges(limit) {
    if (!window.DB) throw new Error('Archivio locale non disponibile');
    var database = await window.DB._ensureDB();
    var transaction = database.transaction(QUEUE_STORE, 'readonly');
    var operations = await requestResult(transaction.objectStore(QUEUE_STORE).getAll());
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
    installStores: installStores,
    hydrate: hydrate,
    reset: reset,
    isPrepared: isPrepared,
    withQueue: withQueue,
    prepareDevice: prepareDevice,
    getStatus: getStatus,
    getPendingChanges: getPendingChanges,
    queueRecipeContent: queueRecipeContent,
    queueRecipeFavorite: queueRecipeFavorite,
    queueRecipeImage: queueRecipeImage,
    queueRecipeDelete: queueRecipeDelete,
    queueCategories: queueCategories
  };
})();
