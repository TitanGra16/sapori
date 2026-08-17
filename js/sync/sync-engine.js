/**
 * Motore local-first della sincronizzazione Sapori.
 *
 * Viene attivato solo dopo un gesto esplicito e una sessione valida. La rete
 * non e mai necessaria per aprire o modificare il ricettario locale.
 */
(function () {
  'use strict';

  var EVENTS = Object.freeze({
    STATE: 'sapori:sync-state',
    QUEUE: 'sapori:queue-changed'
  });
  var ENGINE_LEASE_MS = 60 * 1000;
  var MAX_BATCHES_PER_CYCLE = 5;
  var BATCH_SIZE = 20;
  // Una fotografia puo occupare diversi MB come data URL. Pagine di pull
  // piccole mantengono il picco di memoria sostenibile anche su smartphone.
  var PULL_BATCH_SIZE = 5;
  var MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
  var workerId = 'worker-' + generateId();
  var initialized = false;
  var runningPromise = null;
  var queuedManualPromise = null;
  var scheduledTimer = null;
  var rerunRequested = false;
  var failureCount = 0;
  var listeners = [];
  var state = {
    initialized: false,
    status: 'disabled',
    reason: null,
    accountId: null,
    pendingCount: 0,
    sendingCount: 0,
    blockedCount: 0,
    conflictCount: 0,
    lastSyncAt: null,
    lastError: null,
    online: isOnline(),
    updatedAt: Date.now()
  };

  function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function isOnline() {
    return !window.navigator || window.navigator.onLine !== false;
  }

  function createEvent(name, detail) {
    if (typeof window.CustomEvent === 'function') {
      return new window.CustomEvent(name, { detail: detail });
    }
    var event = document.createEvent('CustomEvent');
    event.initCustomEvent(name, false, false, detail);
    return event;
  }

  function snapshot() {
    return Object.freeze({ ...state });
  }

  function update(changes, reason) {
    state = {
      ...state,
      ...changes,
      reason: reason || changes.reason || 'state-change',
      online: isOnline(),
      updatedAt: Date.now()
    };
    var value = snapshot();
    window.dispatchEvent(createEvent(EVENTS.STATE, Object.freeze({
      reason: reason || 'state-change',
      state: value
    })));
    return value;
  }

  function publicError(error) {
    if (!error) return null;
    return Object.freeze({
      code: String(error.code || 'sync-error').slice(0, 100),
      category: String(error.category || 'unknown').slice(0, 100),
      message: String(error.message || 'Sincronizzazione non disponibile.').slice(0, 300),
      retryable: error.retryable === true,
      at: Date.now()
    });
  }

  function listen(target, name, handler) {
    target.addEventListener(name, handler);
    listeners.push(function () { target.removeEventListener(name, handler); });
  }

  async function binding() {
    return window.SyncPreparation.getAccountBinding();
  }

  function assertExpectedAccount(accountId) {
    var auth = window.AuthService && window.AuthService.getSnapshot();
    if (auth && auth.authenticated && auth.user && auth.user.id === accountId) return;
    throw new window.SyncTransport.SyncTransportError({
      code: 'sync-account-changed',
      category: 'authentication',
      retryable: true,
      message: 'L\u2019account attivo è cambiato durante la sincronizzazione.'
    });
  }

  async function rememberImageCleanup(accountId, paths) {
    await window.SyncLocalStore.queueImageCleanup(accountId, paths);
  }

  async function processImageCleanup(lease, accountId) {
    var paths = await window.SyncLocalStore.getImageCleanup(accountId, 20);
    if (paths.length === 0) return lease;
    lease = await renewOrThrow(lease);
    assertExpectedAccount(accountId);
    try {
      await window.SyncTransport.removeImages(paths);
      assertExpectedAccount(accountId);
      lease = await renewOrThrow(lease);
      await window.SyncLocalStore.acknowledgeImageCleanup(accountId, paths);
    } catch (error) {
      // La lista resta persistente e verra riprovata in un ciclo successivo.
      // Cambio account e perdita del lease devono invece interrompere subito.
      assertExpectedAccount(accountId);
      var classified = window.SyncTransport.classifyError(error);
      if (classified.code === 'sync-lease-lost') throw classified;
    }
    return lease;
  }

  async function refreshState(reason) {
    var preparation = await window.SyncPreparation.getStatus();
    var accountId = preparation.accountId || null;
    var queueStats = accountId ? await window.SyncQueue.getStats() : {
      totalCount: preparation.pendingCount || 0,
      pendingCount: preparation.readyCount || 0,
      sendingCount: preparation.sendingCount || 0,
      blockedCount: preparation.blockedCount || 0,
      leaseActive: false,
      nextAttemptAt: null
    };
    var cursor = preparation.ownerScope
      ? await window.SyncLocalStore.getCursor(preparation.ownerScope)
      : { lastSyncAt: null, lastError: null };
    var conflicts = preparation.ownerScope
      ? await window.SyncLocalStore.getOpenConflicts(preparation.ownerScope)
      : [];
    var auth = window.AuthService ? window.AuthService.getSnapshot() : null;
    var status = state.status;

    if (!preparation.preparationEnabled) status = 'not-prepared';
    else if (!auth || !auth.configured) status = 'disabled';
    else if (!auth.authenticated) status = 'auth-required';
    else if (!isOnline()) status = 'offline';
    else if (conflicts.length > 0) status = 'conflict';
    else if (queueStats.blockedCount > 0) status = 'error';
    else if (cursor.lastError || state.lastError) status = 'error';
    else if (runningPromise || queueStats.sendingCount > 0 || queueStats.leaseActive) {
      status = 'syncing';
    } else status = queueStats.totalCount > 0 ? 'pending' : 'idle';

    return update({
      initialized: true,
      status: status,
      accountId: accountId,
      pendingCount: queueStats.totalCount || 0,
      sendingCount: queueStats.sendingCount || 0,
      blockedCount: queueStats.blockedCount || 0,
      conflictCount: conflicts.length,
      lastSyncAt: cursor.lastSyncAt || null,
      lastError: queueStats.blockedError
        ? publicError(queueStats.blockedError)
        : (cursor.lastError || state.lastError)
    }, reason || 'status-refreshed');
  }

  function coordinationError(message) {
    if (window.SyncTransport && window.SyncTransport.SyncTransportError) {
      return new window.SyncTransport.SyncTransportError({
        code: 'sync-lease-lost',
        category: 'coordination',
        retryable: true,
        message: message || 'Un’altra scheda ha proseguito la sincronizzazione.'
      });
    }
    var error = new Error(message || 'Lease di sincronizzazione non più valido');
    error.code = 'sync-lease-lost';
    error.category = 'coordination';
    error.retryable = true;
    return error;
  }

  async function renewOrThrow(lease) {
    var renewed = await window.SyncQueue.renewLease(lease, {
      workerId: workerId,
      ttlMs: ENGINE_LEASE_MS
    });
    if (!renewed) throw coordinationError();
    return renewed;
  }

  async function prepareImages(lease, accountId, ownerScope, changes) {
    var paths = await window.SyncLocalStore.planImageDownloads(ownerScope, changes);
    var assets = new Map();
    for (var index = 0; index < paths.length; index++) {
      lease = await renewOrThrow(lease);
      assertExpectedAccount(accountId);
      var path = paths[index];
      var blob = await window.SyncTransport.downloadImage(path);
      assertExpectedAccount(accountId);
      lease = await renewOrThrow(lease);
      var dataUrl = await window.SyncSerializer.blobToDataUrl(blob);
      if (!window.DB._isDataImage(dataUrl)) {
        throw new Error('Fotografia cloud non valida');
      }
      var thumbnail = await window.DB._createThumbnail(dataUrl);
      assets.set(path, { data: dataUrl, thumbnail: thumbnail });
    }
    return { assets: assets, lease: lease };
  }

  async function pullAll(lease, accountId, ownerScope) {
    var pages = 0;
    var total = 0;
    var hasMore = true;
    while (hasMore) {
      if (pages >= 100) {
        var pageError = new Error('Troppe pagine cloud in un singolo ciclo');
        pageError.code = 'SYNC_PULL_LIMIT';
        pageError.retryable = true;
        throw pageError;
      }
      lease = await renewOrThrow(lease);
      assertExpectedAccount(accountId);
      var cursor = await window.SyncLocalStore.getCursor(ownerScope);
      var page = await window.SyncTransport.pull(
        cursor.lastPullRevision,
        PULL_BATCH_SIZE,
        accountId
      );
      assertExpectedAccount(accountId);
      lease = await renewOrThrow(lease);
      if (page.changes.length > 0) {
        var preparedImages = await prepareImages(
          lease,
          accountId,
          ownerScope,
          page.changes
        );
        lease = preparedImages.lease;
        assertExpectedAccount(accountId);
        await window.SyncLocalStore.applyRemotePage({
          accountId: accountId,
          page: page,
          imageAssets: preparedImages.assets
        });
        total += page.changes.length;
      }
      hasMore = page.hasMore === true && page.changes.length > 0;
      pages++;
      lease = await renewOrThrow(lease);
    }
    return { lease: lease, pulled: total };
  }

  function operationPriority(operation) {
    if (operation.entityType === 'recipe' && operation.channel === 'content') return 0;
    if (operation.entityType === 'settings') return 1;
    if (operation.channel === 'favorite') return 2;
    if (operation.channel === 'image') return 3;
    return 4;
  }

  async function processBatch(lease, accountId) {
    assertExpectedAccount(accountId);
    lease = await renewOrThrow(lease);
    var claimed = await window.SyncQueue.claimBatch(lease, { limit: BATCH_SIZE });
    claimed.sort(function (first, second) {
      return operationPriority(first) - operationPriority(second) ||
        String(first.entityId).localeCompare(String(second.entityId)) ||
        (Number(first.queuedAt) || 0) - (Number(second.queuedAt) || 0);
    });
    var conflictedEntities = new Set();
    var pushed = 0;

    for (var index = 0; index < claimed.length; index++) {
      lease = await renewOrThrow(lease);
      var claimedOperation = claimed[index];
      var conflictKey = claimedOperation.entityType + ':' + claimedOperation.entityId;
      if (conflictedEntities.has(conflictKey)) {
        await window.SyncQueue.retry(claimedOperation, { retryAfterMs: 0 });
        continue;
      }

      var snapshotPayload;
      var uploadedPath = null;
      try {
        assertExpectedAccount(accountId);
        snapshotPayload = await window.SyncLocalStore.readLeasedPayload(claimedOperation);
        if (snapshotPayload.stale) continue;
        var operation = snapshotPayload.operation;
        if (snapshotPayload.imageUpload) {
          await window.SyncTransport.uploadImage(
            snapshotPayload.imageUpload.path,
            snapshotPayload.imageUpload.blob,
            accountId
          );
          uploadedPath = snapshotPayload.imageUpload.path;
          assertExpectedAccount(accountId);
          lease = await renewOrThrow(lease);
        }

        var result = await window.SyncTransport.push(
          operation,
          snapshotPayload.payload,
          accountId
        );
        assertExpectedAccount(accountId);
        lease = await renewOrThrow(lease);
        if (result.status === 'conflict') {
          conflictedEntities.add(conflictKey);
          if (uploadedPath) {
            await rememberImageCleanup(accountId, [uploadedPath]);
          }
          if (result.remote && result.remote.missing === true) {
            await window.SyncLocalStore.reconcileMissingRemote(operation, accountId);
          } else {
            await window.SyncQueue.rebase(operation, {
              error: {
                code: 'SYNC_SERVER_CONFLICT',
                message: 'Il dato cloud è cambiato durante la sincronizzazione.'
              },
              retryAfterMs: 0
            });
          }
          continue;
        }

        var recorded = await window.SyncLocalStore.recordPushResult(operation, result, {
          accountId: accountId,
          imagePath: uploadedPath
        });
        if (!recorded) {
          throw coordinationError('Lo stato locale è cambiato prima della conferma cloud.');
        }
        if (result.orphanImagePath) {
          await rememberImageCleanup(accountId, [result.orphanImagePath]);
        }
        var acknowledged = await window.SyncQueue.acknowledge(operation);
        if (acknowledged) pushed++;
      } catch (error) {
        try {
          assertExpectedAccount(accountId);
        } catch (accountError) {
          await window.SyncQueue.retry(claimedOperation, {
            error: accountError,
            retryAfterMs: 0
          });
          throw accountError;
        }
        var classified = window.SyncTransport.classifyError(error);
        if (classified.code === 'sync-lease-lost') throw classified;
        if (['sync-account-changed', 'sync-account-mismatch'].indexOf(classified.code) !== -1) {
          await window.SyncQueue.retry(claimedOperation, {
            error: classified,
            retryAfterMs: 0
          });
          throw classified;
        }
        if (classified.reauthRequired && window.AuthService) {
          try {
            await window.AuthService.refreshSession();
            await window.SyncQueue.retry(claimedOperation, {
              error: classified,
              retryAfterMs: 0
            });
          } catch (refreshError) {
            await window.SyncQueue.retry(claimedOperation, {
              error: refreshError,
              retryAfterMs: 30000
            });
          }
        } else if (classified.retryable) {
          await window.SyncQueue.retry(claimedOperation, {
            error: classified,
            retryAfterMs: classified.retryAfterMs
          });
        } else {
          await window.SyncQueue.block(claimedOperation, { error: classified });
        }
      }
      lease = await renewOrThrow(lease);
    }
    return {
      lease: lease,
      claimed: claimed.length,
      pushed: pushed,
      conflicts: conflictedEntities.size
    };
  }

  async function executeCycle(reason) {
    var lease = null;
    var ownerScope = null;
    try {
      var auth = window.AuthService && window.AuthService.getSnapshot();
      if (!auth || !auth.configured || !auth.authenticated ||
          !auth.user || !auth.user.id) {
        return { outcome: 'authentication-required', retryable: false };
      }
      if (!isOnline()) return { outcome: 'offline', retryable: false };

      var accountBinding = await binding();
      if (!accountBinding.preparationEnabled) {
        return { outcome: 'preparation-required', retryable: false };
      }
      // Il primo collegamento dell'archivio a un account e irreversibile: non
      // deve avvenire per un timer o al semplice ritorno dal login OAuth.
      if (!accountBinding.accountId && reason !== 'manual') {
        return { outcome: 'binding-required', retryable: false };
      }
      accountBinding = await window.SyncQueue.bindAccount(auth.user.id);
      ownerScope = accountBinding.ownerScope;
      update({
        status: 'syncing',
        accountId: auth.user.id,
        lastError: null
      }, reason || 'sync-started');

      await window.SyncQueue.recoverExpired();
      lease = await window.SyncQueue.acquireLease({
        workerId: workerId,
        ttlMs: ENGINE_LEASE_MS
      });
      if (!lease) return { outcome: 'another-tab-syncing', retryable: false };

      lease = await processImageCleanup(lease, auth.user.id);

      var firstPull = await pullAll(lease, auth.user.id, ownerScope);
      lease = firstPull.lease;
      var totalClaimed = 0;
      var totalPushed = 0;
      for (var batchIndex = 0; batchIndex < MAX_BATCHES_PER_CYCLE; batchIndex++) {
        var batch = await processBatch(lease, auth.user.id);
        lease = batch.lease;
        totalClaimed += batch.claimed;
        totalPushed += batch.pushed;
        if (batch.claimed === 0 || batch.claimed < BATCH_SIZE || batch.conflicts > 0) break;
      }

      var finalPull = await pullAll(lease, auth.user.id, ownerScope);
      lease = finalPull.lease;
      lease = await processImageCleanup(lease, auth.user.id);
      await window.SyncLocalStore.recordSyncSuccess(ownerScope);
      failureCount = 0;
      await window.SyncQueue.releaseLease(lease, { recoverClaimed: true });
      lease = null;
      return {
        outcome: 'success',
        retryable: false,
        pulled: firstPull.pulled + finalPull.pulled,
        claimed: totalClaimed,
        pushed: totalPushed
      };
    } catch (error) {
      var normalized = window.SyncTransport
        ? window.SyncTransport.classifyError(error)
        : error;
      if (ownerScope) {
        await window.SyncLocalStore.recordCursorError(ownerScope, normalized).catch(function () {});
      }
      if (normalized && normalized.retryable) failureCount++;
      update({
        status: isOnline() ? 'error' : 'offline',
        lastError: publicError(normalized)
      }, 'sync-failed');
      return {
        outcome: 'error',
        retryable: Boolean(normalized && normalized.retryable),
        error: normalized
      };
    } finally {
      if (lease) {
        await window.SyncQueue.releaseLease(lease, { recoverClaimed: true }).catch(function () {});
      }
    }
  }

  function failureRetryDelay() {
    var exponential = Math.min(
      MAX_RETRY_DELAY_MS,
      2000 * Math.pow(2, Math.min(Math.max(failureCount - 1, 0), 7))
    );
    return Math.round(exponential * (0.85 + Math.random() * 0.3));
  }

  async function scheduleFollowUp(result) {
    if (!initialized || !isOnline()) return;
    var auth = window.AuthService && window.AuthService.getSnapshot();
    if (!auth || !auth.authenticated || !auth.user || !auth.user.id) return;
    var accountBinding = await binding().catch(function () { return null; });
    if (!accountBinding || !accountBinding.preparationEnabled ||
        accountBinding.accountId !== auth.user.id) return;
    if (result && [
      'binding-required',
      'authentication-required',
      'preparation-required',
      'offline'
    ].indexOf(result.outcome) !== -1) return;
    if (result && result.outcome === 'error' && result.retryable !== true) return;

    if (result && result.retryable) {
      rerunRequested = false;
      schedule('automatic-retry', failureRetryDelay());
      return;
    }
    if (rerunRequested) {
      rerunRequested = false;
      schedule('changes-during-sync', 150);
      return;
    }

    var stats = await window.SyncQueue.getStats().catch(function () { return null; });
    if (!stats) return;
    if (stats.leaseActive && stats.leaseExpiresAt) {
      schedule(
        'other-tab-lease-expiry',
        Math.max(500, Math.min(ENGINE_LEASE_MS, stats.leaseExpiresAt - Date.now() + 200))
      );
      return;
    } else if (stats.dueCount > 0) {
      schedule('pending-operations', 250);
      return;
    } else if (stats.nextAttemptAt !== null && stats.pendingCount > 0) {
      schedule(
        'retry-window',
        Math.max(250, Math.min(MAX_RETRY_DELAY_MS, stats.nextAttemptAt - Date.now()))
      );
      return;
    }
    var imageCleanup = await window.SyncLocalStore.getImageCleanup(auth.user.id, 1)
      .catch(function () { return []; });
    if (imageCleanup.length > 0) {
      schedule('image-cleanup-retry', MAX_RETRY_DELAY_MS);
    }
  }

  async function runCycle(reason) {
    if (runningPromise) {
      if (reason === 'manual') {
        if (!queuedManualPromise) {
          var activeCycle = runningPromise;
          var startManualCycle = function () {
            return initialized ? runCycle('manual') : snapshot();
          };
          queuedManualPromise = activeCycle.then(
            startManualCycle,
            startManualCycle
          ).finally(function () {
            queuedManualPromise = null;
          });
        }
        return queuedManualPromise;
      }
      rerunRequested = true;
      return runningPromise;
    }
    rerunRequested = false;
    var cyclePromise = (async function () {
      var result = await executeCycle(reason);
      if (runningPromise === cyclePromise) runningPromise = null;
      if (initialized) {
        await refreshState(result.outcome || 'sync-finished').catch(function (error) {
          update({ status: 'error', lastError: publicError(error) }, 'status-refresh-failed');
        });
        await scheduleFollowUp(result);
      }
      return snapshot();
    })();
    runningPromise = cyclePromise;
    return cyclePromise;
  }

  function schedule(reason, delay) {
    if (!initialized) return;
    if (scheduledTimer !== null) window.clearTimeout(scheduledTimer);
    scheduledTimer = window.setTimeout(function () {
      scheduledTimer = null;
      runCycle(reason || 'scheduled').catch(function (error) {
        update({ status: 'error', lastError: publicError(error) }, 'scheduled-sync-failed');
      });
    }, Number.isFinite(Number(delay)) ? Math.max(0, Number(delay)) : 900);
  }

  async function initialize() {
    if (initialized) return refreshState('already-initialized');
    initialized = true;
    listen(window, EVENTS.QUEUE, function (event) {
      var detail = event && event.detail ? event.detail : {};
      if (!runningPromise) {
        refreshState('queue-changed').catch(function () {});
      }
      if (detail.triggerSync !== false) schedule(detail.reason || 'local-change', 900);
    });
    listen(window, 'online', function () { schedule('online', 100); });
    listen(window, 'offline', function () { refreshState('offline').catch(function () {}); });
    listen(document, 'visibilitychange', function () {
      if (document.visibilityState === 'visible') schedule('visible', 300);
    });
    listen(window, 'sapori:auth-state-change', function (event) {
      var auth = event && event.detail && event.detail.state;
      if (auth && auth.authenticated) schedule('signed-in', 100);
      else refreshState('auth-state-changed').catch(function () {});
    });
    await refreshState('initialized').catch(function (error) {
      update({ initialized: true, status: 'error', lastError: publicError(error) }, 'init-failed');
    });
    var auth = window.AuthService && window.AuthService.getSnapshot();
    if (auth && auth.authenticated) schedule('startup', 200);
    return snapshot();
  }

  function destroy() {
    listeners.splice(0).forEach(function (remove) { remove(); });
    if (scheduledTimer !== null) window.clearTimeout(scheduledTimer);
    scheduledTimer = null;
    rerunRequested = false;
    queuedManualPromise = null;
    initialized = false;
    update({ initialized: false, status: 'disabled' }, 'destroyed');
  }

  window.SyncEngine = Object.freeze({
    EVENTS: EVENTS,
    initialize: initialize,
    runNow: function () { return runCycle('manual'); },
    schedule: schedule,
    refreshState: refreshState,
    getSnapshot: snapshot,
    destroy: destroy
  });
})();
