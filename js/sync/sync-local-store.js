/**
 * Ponte atomico fra il motore cloud e IndexedDB.
 *
 * Le modifiche remote vengono applicate direttamente agli object store: non
 * usano i metodi DB pubblici e quindi non generano una nuova operazione di
 * sincronizzazione (eco).
 */
(function () {
  'use strict';

  var QUEUE_STORE = 'syncQueue';
  var META_STORE = 'syncMeta';
  var SHADOW_STORE = 'syncShadow';
  var CONFLICTS_STORE = 'syncConflicts';
  var STATE_KEY = 'state';

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
        reject(transaction.error || new Error('Applicazione remota annullata'));
      };
    });
  }

  async function database() {
    if (!window.DB || typeof window.DB._ensureDB !== 'function') {
      throw new Error('Archivio locale non disponibile');
    }
    return window.DB._ensureDB();
  }

  function entityKey(ownerScope, entityType, entityId, channel) {
    return ownerScope + '|' + entityType + ':' + entityId + ':' + channel;
  }

  function cursorKey(ownerScope) {
    return 'cursor:' + ownerScope;
  }

  function imageCleanupKey(ownerScope) {
    return 'image-cleanup:' + ownerScope;
  }

  function validCleanupPath(accountId, value) {
    if (typeof value !== 'string' || value.length > 1024) return false;
    var parts = value.split('/');
    return parts.length === 3 &&
      parts[0].toLowerCase() === String(accountId || '').toLowerCase() &&
      validRecipeId(parts[1]) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/i.test(parts[2]);
  }

  function safeVersion(value) {
    var number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  function safeRevision(value) {
    var number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  function safeTimestamp(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function remoteTimestamp(value, fallback) {
    var numeric = safeTimestamp(value, null);
    if (numeric) return numeric;
    var parsed = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

  function validRecipeId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
  }

  function validAccountState(state, accountId) {
    return Boolean(
      state && state.key === STATE_KEY && state.intentEnabled === true &&
      typeof state.ownerScope === 'string' && state.ownerScope &&
      typeof state.localProfileId === 'string' && state.localProfileId &&
      typeof state.accountId === 'string' && state.accountId &&
      state.accountId === accountId
    );
  }

  function dispatchDataChanged(detail) {
    if (typeof window.dispatchEvent !== 'function') return;
    var event;
    if (typeof window.CustomEvent === 'function') {
      event = new window.CustomEvent('sapori:data-changed', { detail: detail });
    } else {
      event = document.createEvent('CustomEvent');
      event.initCustomEvent('sapori:data-changed', false, false, detail);
    }
    window.dispatchEvent(event);
  }

  async function getCursor(ownerScope) {
    var db = await database();
    var transaction = db.transaction(META_STORE, 'readonly');
    var record = await requestResult(
      transaction.objectStore(META_STORE).get(cursorKey(ownerScope))
    );
    return {
      lastPullRevision: safeRevision(record && record.lastPullRevision),
      lastSyncAt: safeTimestamp(record && record.lastSyncAt, null),
      lastPushAt: safeTimestamp(record && record.lastPushAt, null),
      lastError: record && record.lastError ? record.lastError : null
    };
  }

  async function getOpenConflicts(ownerScope) {
    var db = await database();
    var transaction = db.transaction(CONFLICTS_STORE, 'readonly');
    var records = await requestResult(transaction.objectStore(CONFLICTS_STORE).getAll());
    return records.filter(function (record) {
      return record && record.ownerScope === ownerScope && record.status === 'open';
    }).sort(function (first, second) {
      return (Number(second.createdAt) || 0) - (Number(first.createdAt) || 0);
    });
  }

  async function queueImageCleanup(accountId, paths) {
    var db = await database();
    var transaction = db.transaction(META_STORE, 'readwrite');
    var completion = transactionComplete(transaction);
    var store = transaction.objectStore(META_STORE);
    var state = await requestResult(store.get(STATE_KEY));
    if (!validAccountState(state, accountId)) {
      await completion;
      return false;
    }
    var key = imageCleanupKey(state.ownerScope);
    var current = await requestResult(store.get(key));
    var pending = new Set(
      Array.isArray(current && current.paths)
        ? current.paths.filter(function (path) { return validCleanupPath(accountId, path); })
        : []
    );
    Array.from(paths || []).forEach(function (path) {
      if (validCleanupPath(accountId, path)) pending.add(path);
    });
    if (pending.size > 5000) {
      transaction.abort();
      await completion.catch(function () {});
      var limitError = new Error('Troppe fotografie attendono la pulizia cloud');
      limitError.code = 'SYNC_IMAGE_CLEANUP_LIMIT';
      throw limitError;
    }
    store.put({
      key: key,
      ownerScope: state.ownerScope,
      accountId: state.accountId,
      paths: Array.from(pending),
      updatedAt: Date.now()
    });
    await completion;
    return true;
  }

  async function getImageCleanup(accountId, limit) {
    var db = await database();
    var transaction = db.transaction(META_STORE, 'readonly');
    var store = transaction.objectStore(META_STORE);
    var state = await requestResult(store.get(STATE_KEY));
    if (!validAccountState(state, accountId)) return [];
    var current = await requestResult(store.get(imageCleanupKey(state.ownerScope)));
    var maximum = Number.isSafeInteger(Number(limit))
      ? Math.max(1, Math.min(Number(limit), 100))
      : 20;
    return (Array.isArray(current && current.paths) ? current.paths : [])
      .filter(function (path) { return validCleanupPath(accountId, path); })
      .slice(0, maximum);
  }

  async function acknowledgeImageCleanup(accountId, paths) {
    var acknowledged = new Set(Array.from(paths || []).filter(function (path) {
      return validCleanupPath(accountId, path);
    }));
    if (acknowledged.size === 0) return false;
    var db = await database();
    var transaction = db.transaction(META_STORE, 'readwrite');
    var completion = transactionComplete(transaction);
    var store = transaction.objectStore(META_STORE);
    var state = await requestResult(store.get(STATE_KEY));
    if (!validAccountState(state, accountId)) {
      await completion;
      return false;
    }
    var key = imageCleanupKey(state.ownerScope);
    var current = await requestResult(store.get(key));
    var remaining = (Array.isArray(current && current.paths) ? current.paths : [])
      .filter(function (path) {
        return validCleanupPath(accountId, path) && !acknowledged.has(path);
      });
    if (remaining.length > 0) {
      store.put({
        ...(current || {}),
        key: key,
        ownerScope: state.ownerScope,
        accountId: state.accountId,
        paths: remaining,
        updatedAt: Date.now()
      });
    } else {
      store.delete(key);
    }
    await completion;
    return true;
  }

  async function planImageDownloads(ownerScope, changes) {
    var db = await database();
    var transaction = db.transaction([SHADOW_STORE, QUEUE_STORE], 'readonly');
    var loaded = await Promise.all([
      requestResult(transaction.objectStore(SHADOW_STORE).getAll()),
      requestResult(transaction.objectStore(QUEUE_STORE).getAll())
    ]);
    var shadows = new Map(loaded[0].map(function (record) { return [record.entityKey, record]; }));
    var queues = new Map(loaded[1].map(function (record) { return [record.entityKey, record]; }));
    var paths = new Set();

    Array.from(changes || []).forEach(function (change) {
      if (!change || change.entityType !== 'recipe' || !validRecipeId(change.entityId)) return;
      var payload = change.payload && typeof change.payload === 'object' ? change.payload : {};
      var path = typeof payload.imagePath === 'string' && payload.imagePath
        ? payload.imagePath
        : null;
      if (!path || payload.deletedAt) return;
      var key = entityKey(ownerScope, 'recipe', change.entityId, 'image');
      var contentKey = entityKey(ownerScope, 'recipe', change.entityId, 'content');
      var shadow = shadows.get(key);
      var pending = queues.get(key);
      var pendingContent = queues.get(contentKey);
      if (pending && pending.action === 'delete' && !pendingContent) return;
      if ((pending && pendingContent) ||
          safeVersion(payload.imageVersion) > safeVersion(shadow && shadow.serverVersion)) {
        paths.add(path);
      }
    });
    return Array.from(paths);
  }

  async function readLeasedPayload(operation) {
    if (!operation || !operation.entityKey || !operation.operationId || !operation.leaseId) {
      return { stale: true };
    }
    var db = await database();
    var stores = [QUEUE_STORE, META_STORE, 'recipes', 'images', 'settings'];
    var transaction = db.transaction(stores, 'readonly');
    var queueStore = transaction.objectStore(QUEUE_STORE);
    var results = await Promise.all([
      requestResult(queueStore.get(operation.entityKey)),
      requestResult(transaction.objectStore(META_STORE).get(STATE_KEY)),
      operation.entityType === 'recipe'
        ? requestResult(transaction.objectStore('recipes').get(operation.entityId))
        : Promise.resolve(null),
      operation.entityType === 'recipe' && operation.channel === 'image'
        ? requestResult(transaction.objectStore('images').get(operation.entityId))
        : Promise.resolve(null),
      operation.entityType === 'settings'
        ? requestResult(transaction.objectStore('settings').get('customCategories'))
        : Promise.resolve(null)
    ]);
    var current = results[0];
    var state = results[1];
    var recipe = results[2];
    var imageRecord = results[3];
    var settingsRecord = results[4];

    if (!current || current.status !== 'sending' ||
        current.operationId !== operation.operationId ||
        current.leaseId !== operation.leaseId ||
        current.ownerScope !== (state && state.ownerScope) ||
        !validAccountState(state, state && state.accountId)) {
      return { stale: true };
    }

    var claimed = {
      ...current,
      deviceId: state.localProfileId,
      // claimBatch ha gia materializzato la base (anche 0 o il null legacy).
      // Non ricalcolarla: dopo un crash lo shadow puo essere gia avanzato.
      baseServerVersion: current.baseServerVersion
    };
    var payload;
    var imageUpload = null;

    if (claimed.entityType === 'recipe' && claimed.channel === 'content') {
      if (claimed.action === 'delete') payload = {};
      else payload = window.SyncSerializer.serializeContent(recipe);
    } else if (claimed.entityType === 'recipe' && claimed.channel === 'favorite') {
      payload = window.SyncSerializer.serializeFavorite(recipe);
    } else if (claimed.entityType === 'recipe' && claimed.channel === 'image') {
      if (claimed.action === 'delete') {
        payload = {};
      } else {
        var blob = window.SyncSerializer.dataUrlToBlob(imageRecord && imageRecord.data);
        var path = window.SyncSerializer.buildStoragePath(
          state.accountId,
          claimed.entityId,
          claimed.operationId,
          blob.type
        );
        payload = window.SyncSerializer.serializeImage(path, blob);
        imageUpload = { path: path, blob: blob };
      }
    } else if (claimed.entityType === 'settings' && claimed.channel === 'categories') {
      payload = window.SyncSerializer.serializeCategories(settingsRecord && settingsRecord.value);
    } else {
      throw new Error('Canale locale non supportato');
    }

    return {
      stale: false,
      operation: claimed,
      payload: payload,
      imageUpload: imageUpload
    };
  }

  async function recordPushResult(operation, result, metadata) {
    metadata = metadata || {};
    if (!operation || !result || result.status !== 'applied') return false;
    var db = await database();
    var transaction = db.transaction(
      [META_STORE, SHADOW_STORE, CONFLICTS_STORE],
      'readwrite'
    );
    var completion = transactionComplete(transaction);
    var metaStore = transaction.objectStore(META_STORE);
    var shadowStore = transaction.objectStore(SHADOW_STORE);
    var conflictStore = transaction.objectStore(CONFLICTS_STORE);
    var loaded = await Promise.all([
      requestResult(metaStore.get(STATE_KEY)),
      requestResult(conflictStore.getAll())
    ]);
    var state = loaded[0];
    var conflictRecords = loaded[1];
    if (!validAccountState(state, metadata.accountId || (state && state.accountId)) ||
        operation.ownerScope !== state.ownerScope) {
      await completion;
      return false;
    }

    var existing = await requestResult(shadowStore.get(operation.entityKey));
    var revision = safeRevision(result.revision);
    var serverVersion = safeVersion(result.serverVersion);
    if (!existing || revision >= safeRevision(existing.serverRevision)) {
      shadowStore.put({
        ...(existing || {}),
        entityKey: operation.entityKey,
        ownerScope: state.ownerScope,
        entityType: operation.entityType,
        entityId: operation.entityId,
        channel: operation.channel,
        serverVersion: serverVersion,
        serverRevision: revision,
        deleted: operation.channel === 'content' && operation.action === 'delete',
        remotePath: operation.channel === 'image'
          ? (operation.action === 'delete' ? null : metadata.imagePath || null)
          : (existing && existing.remotePath) || null,
        updatedAt: Date.now()
      });
    }

    var key = cursorKey(state.ownerScope);
    var cursor = await requestResult(metaStore.get(key));
    metaStore.put({
      ...(cursor || {}),
      key: key,
      ownerScope: state.ownerScope,
      lastPullRevision: safeRevision(cursor && cursor.lastPullRevision),
      lastPushAt: Date.now(),
      lastError: null
    });
    conflictRecords.forEach(function (record) {
      if (!record || record.ownerScope !== state.ownerScope || record.status !== 'open') return;
      if (operation.entityType === 'settings' && record.entityType === 'settings' &&
          record.entityId === operation.entityId && operation.channel === 'categories') {
        conflictStore.put({ ...record, status: 'resolved', resolvedAt: Date.now() });
        return;
      }
      if (record.preservedRecipeId !== operation.entityId) return;
      conflictStore.put(advanceRecipeConflict(record, operation.channel, Date.now()));
    });
    await completion;
    return true;
  }

  async function reconcileMissingRemote(operation, accountId) {
    if (!operation || operation.entityType !== 'recipe' ||
        !validRecipeId(operation.entityId)) return false;
    var db = await database();
    var transaction = db.transaction(
      [QUEUE_STORE, META_STORE, SHADOW_STORE, 'recipes'],
      'readwrite'
    );
    var completion = transactionComplete(transaction);
    var queueStore = transaction.objectStore(QUEUE_STORE);
    var metaStore = transaction.objectStore(META_STORE);
    var shadowStore = transaction.objectStore(SHADOW_STORE);
    var contentKey = entityKey(
      operation.ownerScope,
      'recipe',
      operation.entityId,
      'content'
    );
    var loaded = await Promise.all([
      requestResult(metaStore.get(STATE_KEY)),
      requestResult(queueStore.get(operation.entityKey)),
      requestResult(queueStore.get(contentKey)),
      requestResult(transaction.objectStore('recipes').get(operation.entityId))
    ]);
    var state = loaded[0];
    var current = loaded[1];
    var existingContent = loaded[2];
    var recipe = loaded[3];
    if (!validAccountState(state, accountId) || !current ||
        current.status !== 'sending' ||
        current.operationId !== operation.operationId ||
        current.leaseId !== operation.leaseId) {
      await completion;
      return false;
    }

    ['content', 'favorite', 'image'].forEach(function (channel) {
      shadowStore.delete(entityKey(
        state.ownerScope,
        'recipe',
        operation.entityId,
        channel
      ));
    });

    var now = Date.now();
    if (operation.channel === 'content') {
      queueStore.put(rebaseOperation(current, now));
    } else if (!recipe) {
      queueStore.delete(operation.entityKey);
    } else if (existingContent && existingContent.action === 'delete') {
      queueStore.put(rebaseOperation(existingContent, now));
      queueStore.delete(operation.entityKey);
    } else {
      var contentSeed = existingContent || {
        ...current,
        entityKey: contentKey,
        entityType: 'recipe',
        channel: 'content',
        action: 'upsert',
        queuedAt: now
      };
      queueStore.put(rebaseOperation(contentSeed, now));
      queueStore.put(rebaseOperation(current, now));
    }
    await completion;
    if (window.SyncPreparation &&
        typeof window.SyncPreparation.notifyQueueChanged === 'function') {
      window.SyncPreparation.notifyQueueChanged('remote-entity-recreated');
    }
    return true;
  }

  function shadowRecord(ownerScope, entityType, entityId, channel, version, revision, extras) {
    return {
      ...(extras || {}),
      entityKey: entityKey(ownerScope, entityType, entityId, channel),
      ownerScope: ownerScope,
      entityType: entityType,
      entityId: entityId,
      channel: channel,
      serverVersion: safeVersion(version),
      serverRevision: safeRevision(revision),
      updatedAt: Date.now()
    };
  }

  function remoteStoredRecipe(current, entityId, content, now) {
    content = content && typeof content === 'object' ? content : {};
    var normalized = window.SyncSerializer.serializeContent(content).recipe;
    return {
      ...(current || {}),
      id: entityId,
      name: normalized.name || (current && current.name) || 'Ricetta',
      category: normalized.category || (current && current.category) || 'altro',
      description: normalized.description,
      notes: normalized.notes,
      storage: normalized.storage,
      ingredients: normalized.ingredients,
      steps: normalized.steps,
      prepTime: normalized.prepTime,
      cookTime: normalized.cookTime,
      difficulty: normalized.difficulty,
      servings: normalized.servings,
      createdAt: safeTimestamp(normalized.createdAt, (current && current.createdAt) || now),
      updatedAt: safeTimestamp(normalized.updatedAt, now),
      image: null,
      contentVersion: safeVersion(current && current.contentVersion) + 1,
      favoriteVersion: safeVersion(current && current.favoriteVersion),
      imageVersion: safeVersion(current && current.imageVersion)
    };
  }

  function rebaseOperation(operation, now) {
    return {
      ...operation,
      operationId: generateId(),
      baseServerVersion: null,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      leaseId: null,
      leaseExpiresAt: null,
      claimedAt: null,
      blockedAt: null,
      updatedAt: now,
      recoveryReason: 'remote-rebase'
    };
  }

  function advanceRecipeConflict(record, channel, now) {
    var details = record.details && typeof record.details === 'object' ? record.details : {};
    var requiredChannels = Array.isArray(details.requiredChannels)
      ? details.requiredChannels
      : ['content', 'favorite'];
    var syncedChannels = new Set(Array.isArray(details.syncedChannels)
      ? details.syncedChannels
      : []);
    syncedChannels.add(channel);
    var nextDetails = {
      ...details,
      requiredChannels: requiredChannels,
      syncedChannels: Array.from(syncedChannels).sort()
    };
    var resolved = requiredChannels.every(function (requiredChannel) {
      return syncedChannels.has(requiredChannel);
    });
    return {
      ...record,
      details: nextDetails,
      status: resolved ? 'resolved' : 'open',
      resolvedAt: resolved ? now : null
    };
  }

  function imagePathMatchesOperation(path, operationId) {
    if (typeof path !== 'string' || typeof operationId !== 'string') return false;
    var filename = path.split('/').pop() || '';
    return filename.indexOf(operationId + '.') === 0;
  }

  function queueForCopy(transaction, copy, hasImage, changedAt) {
    window.SyncPreparation.queueRecipeContent(transaction, copy.id, changedAt);
    window.SyncPreparation.queueRecipeFavorite(transaction, copy.id, changedAt);
    if (hasImage) {
      window.SyncPreparation.queueRecipeImage(transaction, copy.id, true, changedAt);
    }
  }

  /**
   * Applica una pagina pull e il relativo cursore nella stessa transazione.
   * `imageAssets` e una Map path -> {data, thumbnail}, preparata prima di aprire
   * la transazione; se un path necessario manca, l'intera pagina viene rifiutata.
   */
  async function applyRemotePage(options) {
    options = options || {};
    var accountId = options.accountId;
    var page = options.page || {};
    var changes = Array.isArray(page.changes) ? page.changes.slice() : [];
    var imageAssets = options.imageAssets instanceof Map ? options.imageAssets : new Map();
    var db = await database();
    var storeNames = [
      'recipes', 'images', 'settings', QUEUE_STORE, META_STORE,
      SHADOW_STORE, CONFLICTS_STORE
    ];
    var transaction = db.transaction(storeNames, 'readwrite');
    var completion = transactionComplete(transaction);
    var recipeStore = transaction.objectStore('recipes');
    var imageStore = transaction.objectStore('images');
    var settingsStore = transaction.objectStore('settings');
    var queueStore = transaction.objectStore(QUEUE_STORE);
    var metaStore = transaction.objectStore(META_STORE);
    var shadowStore = transaction.objectStore(SHADOW_STORE);
    var conflictStore = transaction.objectStore(CONFLICTS_STORE);
    var pageRecipeIds = Array.from(new Set(changes
      .filter(function (change) {
        return change && change.entityType === 'recipe' && validRecipeId(change.entityId);
      })
      .map(function (change) { return change.entityId; })));
    var loaded = await Promise.all([
      requestResult(metaStore.get(STATE_KEY)),
      Promise.all(pageRecipeIds.map(function (recipeId) {
        return requestResult(recipeStore.get(recipeId));
      })),
      Promise.all(pageRecipeIds.map(function (recipeId) {
        return requestResult(imageStore.get(recipeId));
      })),
      requestResult(recipeStore.getAllKeys()),
      requestResult(settingsStore.get('customCategories')),
      requestResult(queueStore.getAll()),
      requestResult(shadowStore.getAll()),
      requestResult(conflictStore.getAll())
    ]);
    var state = loaded[0];
    if (!validAccountState(state, accountId)) {
      transaction.abort();
      await completion.catch(function () {});
      var accountError = new Error('Account cloud diverso dall archivio locale');
      accountError.code = 'SYNC_ACCOUNT_MISMATCH';
      throw accountError;
    }

    var ownerScope = state.ownerScope;
    var recipes = new Map(loaded[1]
      .filter(Boolean)
      .map(function (record) { return [record.id, record]; }));
    var images = new Map(loaded[2]
      .filter(Boolean)
      .map(function (record) { return [record.recipeId, record]; }));
    var knownRecipeIds = new Set(loaded[3]);
    var settingsRecord = loaded[4];
    var queues = new Map(loaded[5].map(function (record) { return [record.entityKey, record]; }));
    var shadows = new Map(loaded[6].map(function (record) { return [record.entityKey, record]; }));
    var conflicts = new Map(loaded[7].map(function (record) { return [record.id, record]; }));
    var changedRecipeIds = new Set();
    var createdConflicts = [];
    var categoriesChanged = false;
    var queueChanged = false;
    var now = Date.now();

    function markPreservedConflict(entityId, channel) {
      Array.from(conflicts.values()).forEach(function (record) {
        if (!record || record.status !== 'open' ||
            record.preservedRecipeId !== entityId) return;
        var updated = advanceRecipeConflict(record, channel, now);
        conflictStore.put(updated);
        conflicts.set(updated.id, updated);
      });
    }

    function resolveSettingsConflicts() {
      Array.from(conflicts.values()).forEach(function (record) {
        if (!record || record.status !== 'open' || record.entityType !== 'settings' ||
            record.entityId !== 'customCategories') return;
        var updated = { ...record, status: 'resolved', resolvedAt: now };
        conflictStore.put(updated);
        conflicts.set(updated.id, updated);
      });
    }

    changes.sort(function (first, second) {
      var firstSettings = first && first.entityType === 'settings' ? 0 : 1;
      var secondSettings = second && second.entityType === 'settings' ? 0 : 1;
      return firstSettings - secondSettings ||
        safeRevision(first && first.revision) - safeRevision(second && second.revision);
    });

    changes.forEach(function (change) {
      if (!change || typeof change !== 'object') throw new Error('Modifica remota non valida');
      var revision = safeRevision(change.revision);
      var payload = change.payload && typeof change.payload === 'object' ? change.payload : {};

      if (change.entityType === 'settings' && change.entityId === 'customCategories') {
        var settingsKey = entityKey(ownerScope, 'settings', 'customCategories', 'categories');
        var settingsShadow = shadows.get(settingsKey);
        var remoteSettingsVersion = safeVersion(payload.categoriesVersion);
        var pendingSettings = queues.get(settingsKey);
        var remoteItems = window.SyncSerializer.serializeCategories(payload.items).items;
        var localValue = settingsRecord && settingsRecord.value;

        if (pendingSettings && remoteSettingsVersion > safeVersion(settingsShadow && settingsShadow.serverVersion)) {
          var localItems = window.SyncSerializer.serializeCategories(localValue).items;
          if (window.SyncConflicts.stableStringify(localItems) ===
              window.SyncConflicts.stableStringify(remoteItems)) {
            queueStore.delete(settingsKey);
            queues.delete(settingsKey);
            pendingSettings = null;
            queueChanged = true;
            settingsRecord = { key: 'customCategories', value: JSON.stringify(remoteItems) };
            resolveSettingsConflicts();
          } else {
            var mergedItems = window.SyncConflicts.mergeCategories(localValue, remoteItems);
            pendingSettings = rebaseOperation(pendingSettings, now);
            if (mergedItems.length > 100) {
              pendingSettings = {
                ...pendingSettings,
                status: 'blocked',
                nextAttemptAt: 0,
                blockedAt: now,
                lastError: {
                  code: 'SYNC_CATEGORY_LIMIT_CONFLICT',
                  message: 'Le categorie locali e cloud superano insieme il limite di 100.',
                  at: now
                }
              };
              var settingsConflictId = window.SyncConflicts.buildSettingsConflictId(
                ownerScope,
                revision
              );
              if (!conflicts.has(settingsConflictId)) {
                var settingsConflict = window.SyncConflicts.createRecord({
                  id: settingsConflictId,
                  ownerScope: ownerScope,
                  entityType: 'settings',
                  entityId: 'customCategories',
                  channels: ['categories'],
                  remoteRevision: revision,
                  createdAt: remoteTimestamp(payload.updatedAt, now),
                  details: {
                    localItems: localItems,
                    remoteItems: remoteItems,
                    reason: 'category-limit',
                    requiredChannels: ['categories']
                  }
                });
                conflictStore.put(settingsConflict);
                conflicts.set(settingsConflictId, settingsConflict);
                createdConflicts.push(settingsConflict);
              }
            } else {
              settingsRecord = {
                key: 'customCategories',
                value: JSON.stringify(mergedItems)
              };
              settingsStore.put(settingsRecord);
              categoriesChanged = true;
            }
            queueStore.put(pendingSettings);
            queues.set(settingsKey, pendingSettings);
            queueChanged = true;
          }
          if (!pendingSettings) {
            settingsStore.put(settingsRecord);
            categoriesChanged = true;
          }
        } else if (!pendingSettings &&
                   remoteSettingsVersion > safeVersion(settingsShadow && settingsShadow.serverVersion)) {
          settingsRecord = { key: 'customCategories', value: JSON.stringify(remoteItems) };
          settingsStore.put(settingsRecord);
          categoriesChanged = true;
        }

        var nextSettingsShadow = shadowRecord(
          ownerScope,
          'settings',
          'customCategories',
          'categories',
          remoteSettingsVersion,
          revision
        );
        shadowStore.put(nextSettingsShadow);
        shadows.set(settingsKey, nextSettingsShadow);
        return;
      }

      if (change.entityType !== 'recipe' || !validRecipeId(change.entityId)) {
        throw new Error('Entita remota non supportata');
      }

      var recipeId = change.entityId;
      var current = recipes.get(recipeId) || null;
      var currentImage = images.get(recipeId) || null;
      var contentKey = entityKey(ownerScope, 'recipe', recipeId, 'content');
      var favoriteKey = entityKey(ownerScope, 'recipe', recipeId, 'favorite');
      var imageKey = entityKey(ownerScope, 'recipe', recipeId, 'image');
      var pendingContent = queues.get(contentKey);
      var pendingFavorite = queues.get(favoriteKey);
      var pendingImage = queues.get(imageKey);
      var contentShadow = shadows.get(contentKey);
      var favoriteShadow = shadows.get(favoriteKey);
      var imageShadow = shadows.get(imageKey);
      var remoteContentVersion = safeVersion(payload.contentVersion);
      var remoteFavoriteVersion = safeVersion(payload.favoriteVersion);
      var remoteImageVersion = safeVersion(payload.imageVersion);
      var remoteDeleted = Boolean(payload.deletedAt);
      var remotePath = typeof payload.imagePath === 'string' && payload.imagePath
        ? payload.imagePath
        : null;
      var conflictChannels = [];
      var forceRemoteContent = false;
      var forceRemoteFavorite = false;
      var forceRemoteImage = false;
      var keepLocallyDeleted = Boolean(
        pendingContent && pendingContent.action === 'delete'
      );

      if (remoteDeleted) {
        if (current && (
          (pendingContent && pendingContent.action !== 'delete') || pendingFavorite || pendingImage
        )) {
          conflictChannels.push('delete');
        } else if (pendingContent && pendingContent.action === 'delete') {
          queueStore.delete(contentKey);
          queues.delete(contentKey);
          pendingContent = null;
          queueChanged = true;
          markPreservedConflict(recipeId, 'content');
        }
      } else {
        if (pendingContent && pendingContent.action === 'delete' &&
            remoteContentVersion > safeVersion(contentShadow && contentShadow.serverVersion)) {
          pendingContent = rebaseOperation(pendingContent, now);
          queueStore.put(pendingContent);
          queues.set(contentKey, pendingContent);
          queueChanged = true;
        } else if (pendingContent &&
            remoteContentVersion > safeVersion(contentShadow && contentShadow.serverVersion)) {
          if (current && window.SyncConflicts.contentEquals(current, payload.content)) {
            queueStore.delete(contentKey);
            queues.delete(contentKey);
            pendingContent = null;
            queueChanged = true;
            markPreservedConflict(recipeId, 'content');
          } else {
            conflictChannels.push('content');
          }
        }
        if (pendingImage &&
            remoteImageVersion > safeVersion(imageShadow && imageShadow.serverVersion)) {
          if (pendingImage.action === 'delete') {
            if (!remotePath) {
              queueStore.delete(imageKey);
              queues.delete(imageKey);
              pendingImage = null;
              queueChanged = true;
              markPreservedConflict(recipeId, 'image');
            } else {
              pendingImage = rebaseOperation(pendingImage, now);
              queueStore.put(pendingImage);
              queues.set(imageKey, pendingImage);
              queueChanged = true;
            }
          } else {
            var remoteAsset = remotePath ? imageAssets.get(remotePath) : null;
            var sameImage = Boolean(
              currentImage && currentImage.data && remoteAsset &&
              remoteAsset.data === currentImage.data
            );
            if (sameImage || imagePathMatchesOperation(remotePath, pendingImage.operationId)) {
              queueStore.delete(imageKey);
              queues.delete(imageKey);
              pendingImage = null;
              queueChanged = true;
              markPreservedConflict(recipeId, 'image');
            } else if (!currentImage || !currentImage.data) {
              queueStore.delete(imageKey);
              queues.delete(imageKey);
              pendingImage = null;
              queueChanged = true;
            } else {
              conflictChannels.push('image');
            }
          }
        }
      }

      if (conflictChannels.length && current) {
        var conflictId = window.SyncConflicts.buildConflictId(
          ownerScope,
          recipeId,
          revision,
          conflictChannels
        );
        if (!conflicts.has(conflictId)) {
          var copyId = window.SyncConflicts.buildCopyId(
            recipeId,
            conflictId,
            knownRecipeIds
          );
          var conflictAt = remoteTimestamp(payload.updatedAt, now);
          var copy = {
            ...current,
            id: copyId,
            name: window.SyncConflicts.copyName(current.name, conflictAt),
            createdAt: conflictAt,
            updatedAt: conflictAt,
            contentVersion: 1,
            favoriteVersion: 1,
            imageVersion: currentImage && currentImage.data ? 1 : 0
          };
          recipeStore.put(copy);
          recipes.set(copyId, copy);
          knownRecipeIds.add(copyId);
          if (currentImage && currentImage.data) {
            var copyImage = { recipeId: copyId, data: currentImage.data };
            imageStore.put(copyImage);
            images.set(copyId, copyImage);
          }
          queueForCopy(transaction, copy, Boolean(currentImage && currentImage.data), conflictAt);
          var conflictRecord = window.SyncConflicts.createRecord({
            id: conflictId,
            ownerScope: ownerScope,
            entityId: recipeId,
            channels: conflictChannels,
            preservedRecipeId: copyId,
            remoteRevision: revision,
            createdAt: conflictAt,
            details: {
              requiredChannels: currentImage && currentImage.data
                ? ['content', 'favorite', 'image']
                : ['content', 'favorite'],
              syncedChannels: []
            }
          });
          conflictStore.put(conflictRecord);
          conflicts.set(conflictId, conflictRecord);
          createdConflicts.push(conflictRecord);
        }
        forceRemoteContent = Boolean(pendingContent);
        forceRemoteFavorite = Boolean(pendingFavorite);
        forceRemoteImage = Boolean(pendingImage);
        [contentKey, favoriteKey, imageKey].forEach(function (key) {
          queueStore.delete(key);
          queues.delete(key);
        });
        pendingContent = pendingFavorite = pendingImage = null;
        queueChanged = true;
      }

      if (remoteDeleted) {
        [contentKey, favoriteKey, imageKey].forEach(function (key) {
          queueStore.delete(key);
          queues.delete(key);
        });
        recipeStore.delete(recipeId);
        imageStore.delete(recipeId);
        recipes.delete(recipeId);
        images.delete(recipeId);
        knownRecipeIds.delete(recipeId);
        changedRecipeIds.add(recipeId);
      } else if (keepLocallyDeleted) {
        recipeStore.delete(recipeId);
        imageStore.delete(recipeId);
        recipes.delete(recipeId);
        images.delete(recipeId);
        knownRecipeIds.delete(recipeId);
      } else {
        var next = current ? { ...current } : {
          id: recipeId,
          isFavorite: false,
          image: null,
          imageThumbnail: null,
          hasImage: false,
          createdAt: now,
          updatedAt: now,
          contentVersion: 0,
          favoriteVersion: 0,
          imageVersion: 0
        };
        var shouldApplyContent = !pendingContent &&
          (forceRemoteContent || !current ||
            remoteContentVersion > safeVersion(contentShadow && contentShadow.serverVersion));
        if (shouldApplyContent) {
          next = remoteStoredRecipe(next, recipeId, payload.content, now);
        }

        var shouldApplyFavorite = !pendingFavorite &&
          (!current || remoteFavoriteVersion > safeVersion(favoriteShadow && favoriteShadow.serverVersion));
        if (pendingFavorite &&
            remoteFavoriteVersion > safeVersion(favoriteShadow && favoriteShadow.serverVersion) &&
            current && current.isFavorite === (payload.isFavorite === true)) {
          queueStore.delete(favoriteKey);
          queues.delete(favoriteKey);
          pendingFavorite = null;
          queueChanged = true;
          markPreservedConflict(recipeId, 'favorite');
          shouldApplyFavorite = true;
        } else if (pendingFavorite &&
                   remoteFavoriteVersion > safeVersion(favoriteShadow && favoriteShadow.serverVersion)) {
          pendingFavorite = rebaseOperation(pendingFavorite, now);
          queueStore.put(pendingFavorite);
          queues.set(favoriteKey, pendingFavorite);
          queueChanged = true;
        }
        if (forceRemoteFavorite) shouldApplyFavorite = true;
        if (shouldApplyFavorite) {
          next.isFavorite = payload.isFavorite === true;
          next.favoriteVersion = safeVersion(next.favoriteVersion) + 1;
        }

        var shouldApplyImage = !pendingImage &&
          (forceRemoteImage || !current ||
            remoteImageVersion > safeVersion(imageShadow && imageShadow.serverVersion));
        if (shouldApplyImage) {
          if (remotePath) {
            var asset = imageAssets.get(remotePath);
            if (!asset || typeof asset.data !== 'string') {
              throw new Error('Fotografia remota non preparata');
            }
            var nextImage = { recipeId: recipeId, data: asset.data };
            imageStore.put(nextImage);
            images.set(recipeId, nextImage);
            next.imageThumbnail = asset.thumbnail || null;
            next.hasImage = true;
          } else if (remoteImageVersion > 0 || currentImage) {
            imageStore.delete(recipeId);
            images.delete(recipeId);
            next.imageThumbnail = null;
            next.hasImage = false;
          }
          if (remotePath || remoteImageVersion > 0 || currentImage) {
            next.imageVersion = safeVersion(next.imageVersion) + 1;
          }
        }

        next.image = null;
        recipeStore.put(next);
        recipes.set(recipeId, next);
        knownRecipeIds.add(recipeId);
        changedRecipeIds.add(recipeId);
      }

      var nextContentShadow = shadowRecord(
        ownerScope, 'recipe', recipeId, 'content', remoteContentVersion, revision,
        { deleted: remoteDeleted }
      );
      var nextFavoriteShadow = shadowRecord(
        ownerScope, 'recipe', recipeId, 'favorite', remoteFavoriteVersion, revision,
        { deleted: remoteDeleted }
      );
      var nextImageShadow = shadowRecord(
        ownerScope, 'recipe', recipeId, 'image', remoteImageVersion, revision,
        { deleted: remoteDeleted, remotePath: remotePath }
      );
      [nextContentShadow, nextFavoriteShadow, nextImageShadow].forEach(function (record) {
        shadowStore.put(record);
        shadows.set(record.entityKey, record);
      });
    });

    var key = cursorKey(ownerScope);
    var currentCursor = await requestResult(metaStore.get(key));
    var nextRevision = Math.max(
      safeRevision(currentCursor && currentCursor.lastPullRevision),
      safeRevision(page.lastRevision)
    );
    metaStore.put({
      ...(currentCursor || {}),
      key: key,
      ownerScope: ownerScope,
      lastPullRevision: nextRevision,
      lastSyncAt: now,
      lastError: null
    });

    await completion;
    if (queueChanged && window.SyncPreparation &&
        typeof window.SyncPreparation.notifyQueueChanged === 'function') {
      window.SyncPreparation.notifyQueueChanged('remote-queue-reconciled');
    }
    var detail = {
      source: 'remote',
      recipeIds: Array.from(changedRecipeIds),
      categoriesChanged: categoriesChanged,
      conflictCount: createdConflicts.length,
      lastRevision: nextRevision
    };
    dispatchDataChanged(detail);
    return detail;
  }

  async function recordCursorError(ownerScope, error) {
    var db = await database();
    var transaction = db.transaction(META_STORE, 'readwrite');
    var completion = transactionComplete(transaction);
    var store = transaction.objectStore(META_STORE);
    var state = await requestResult(store.get(STATE_KEY));
    if (!state || state.ownerScope !== ownerScope) {
      await completion;
      return false;
    }
    var key = cursorKey(ownerScope);
    var current = await requestResult(store.get(key));
    store.put({
      ...(current || {}),
      key: key,
      ownerScope: ownerScope,
      lastPullRevision: safeRevision(current && current.lastPullRevision),
      lastError: error ? {
        code: String(error.code || 'sync-error').slice(0, 100),
        category: String(error.category || 'unknown').slice(0, 100),
        message: String(error.message || 'Errore di sincronizzazione').slice(0, 300),
        retryable: error.retryable === true,
        at: Date.now()
      } : null
    });
    await completion;
    return true;
  }

  async function recordSyncSuccess(ownerScope) {
    var db = await database();
    var transaction = db.transaction(META_STORE, 'readwrite');
    var completion = transactionComplete(transaction);
    var store = transaction.objectStore(META_STORE);
    var state = await requestResult(store.get(STATE_KEY));
    if (!state || state.ownerScope !== ownerScope) {
      await completion;
      return false;
    }
    var key = cursorKey(ownerScope);
    var current = await requestResult(store.get(key));
    store.put({
      ...(current || {}),
      key: key,
      ownerScope: ownerScope,
      lastPullRevision: safeRevision(current && current.lastPullRevision),
      lastSyncAt: Date.now(),
      lastError: null
    });
    await completion;
    return true;
  }

  window.SyncLocalStore = Object.freeze({
    getCursor: getCursor,
    getOpenConflicts: getOpenConflicts,
    queueImageCleanup: queueImageCleanup,
    getImageCleanup: getImageCleanup,
    acknowledgeImageCleanup: acknowledgeImageCleanup,
    planImageDownloads: planImageDownloads,
    readLeasedPayload: readLeasedPayload,
    recordPushResult: recordPushResult,
    reconcileMissingRemote: reconcileMissingRemote,
    applyRemotePage: applyRemotePage,
    recordCursorError: recordCursorError,
    recordSyncSuccess: recordSyncSuccess
  });
})();
