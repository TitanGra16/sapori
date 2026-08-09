/**
 * Coordinamento dell'interfaccia Account e sincronizzazione.
 *
 * Mantiene separati preparazione locale, autenticazione e motore sync, quindi
 * compone solo i dati pubblici necessari alla vista. L'avvio cloud resta
 * intenzionalmente non bloccante: un errore di rete non impedisce mai di usare
 * il ricettario locale.
 */
(function () {
  'use strict';

  var EVENTS = Object.freeze({
    STATE: 'sapori:account-state'
  });
  var initialized = false;
  var initializationPromise = null;
  var refreshPromise = null;
  var refreshTimer = null;
  var listeners = [];
  var state = createEmptyState();

  function createEmptyState() {
    return {
      initialized: false,
      status: 'loading',
      prepared: false,
      preparedAt: null,
      authenticated: false,
      configured: false,
      bound: false,
      accountMismatch: false,
      online: !window.navigator || window.navigator.onLine !== false,
      syncing: false,
      pendingCount: 0,
      pendingRecipeCount: 0,
      sendingCount: 0,
      blockedCount: 0,
      conflictCount: 0,
      recipeCount: 0,
      lastSyncAt: null,
      lastError: null,
      user: null,
      syncStatus: 'disabled',
      updatedAt: Date.now()
    };
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

  function safeError(error, fallback) {
    if (!error) return null;
    return Object.freeze({
      code: String(error.code || 'account-error').slice(0, 100),
      category: String(error.category || 'unknown').slice(0, 100),
      message: String(error.message || fallback || 'Operazione cloud non disponibile.').slice(0, 300),
      retryable: error.retryable === true
    });
  }

  function publish(nextState, reason) {
    state = {
      ...createEmptyState(),
      ...nextState,
      initialized: true,
      updatedAt: Date.now()
    };
    var value = snapshot();
    window.dispatchEvent(createEvent(EVENTS.STATE, Object.freeze({
      reason: reason || 'state-change',
      state: value
    })));
    if (window.AccountView && typeof window.AccountView.updateStatus === 'function') {
      window.AccountView.updateStatus(document, value);
    }
    return value;
  }

  function mismatchError() {
    return Object.freeze({
      code: 'SYNC_ACCOUNT_MISMATCH',
      category: 'account',
      message: 'Questo dispositivo è già associato a un altro account. Esci e accedi con l’account usato durante il primo collegamento.',
      retryable: false
    });
  }

  function deriveStatus(values) {
    if (!values.prepared) return 'not-prepared';
    if (!values.configured) return 'not-configured';
    if (values.authStatus === 'initializing' || !values.authInitialized) return 'initializing';
    if (values.accountMismatch) return 'account-mismatch';
    if (!values.online) return 'offline';
    if (!values.authenticated) return 'auth-required';
    if (!values.bound) return 'binding-required';
    if (values.syncing) return 'syncing';
    if (values.lastError || values.blockedCount > 0) return 'error';
    if (values.conflictCount > 0) return 'conflict';
    if (values.pendingCount > 0 || values.sendingCount > 0) return 'pending';
    return values.lastSyncAt ? 'synced' : 'ready';
  }

  async function readState(reason) {
    var preparation = await window.SyncPreparation.getStatus();
    var auth = window.AuthService && typeof window.AuthService.getSnapshot === 'function'
      ? window.AuthService.getSnapshot()
      : null;
    var sync = window.SyncEngine && typeof window.SyncEngine.getSnapshot === 'function'
      ? window.SyncEngine.getSnapshot()
      : null;
    var userId = auth && auth.user && auth.user.id ? auth.user.id : null;
    var accountId = preparation.accountId || null;
    var accountMismatch = Boolean(accountId && userId && accountId !== userId);
    var values = {
      prepared: preparation.preparationEnabled === true,
      preparedAt: preparation.preparedAt || null,
      configured: Boolean(auth && auth.configured),
      authInitialized: Boolean(auth && auth.initialized),
      authStatus: auth ? auth.status : 'unavailable',
      authenticated: Boolean(auth && auth.authenticated && userId),
      bound: Boolean(accountId && userId && accountId === userId),
      accountMismatch: accountMismatch,
      online: Boolean(
        (!window.navigator || window.navigator.onLine !== false) &&
        (!auth || auth.online !== false)
      ),
      syncing: Boolean(sync && sync.status === 'syncing'),
      pendingCount: Math.max(
        Number(preparation.pendingCount) || 0,
        sync ? (Number(sync.pendingCount) || 0) + (Number(sync.sendingCount) || 0) : 0
      ),
      pendingRecipeCount: Number(preparation.pendingRecipeCount) || 0,
      sendingCount: sync ? Number(sync.sendingCount) || 0 : Number(preparation.sendingCount) || 0,
      blockedCount: sync ? Number(sync.blockedCount) || 0 : Number(preparation.blockedCount) || 0,
      conflictCount: sync ? Number(sync.conflictCount) || 0 : 0,
      recipeCount: Number(preparation.recipeCount) || 0,
      lastSyncAt: sync && sync.lastSyncAt ? Number(sync.lastSyncAt) || null : null,
      lastError: accountMismatch
        ? mismatchError()
        : safeError(
            (sync && sync.lastError) || (auth && auth.error),
            'Sincronizzazione non disponibile.'
          ),
      user: auth && auth.user ? auth.user : null,
      syncStatus: sync ? sync.status : 'disabled'
    };
    values.status = deriveStatus(values);
    return publish(values, reason || 'refreshed');
  }

  function refresh(reason) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = readState(reason).catch(function (error) {
      var next = {
        ...state,
        status: state.prepared ? 'error' : state.status,
        lastError: safeError(error, 'Non riesco a leggere lo stato della sincronizzazione.')
      };
      return publish(next, 'refresh-failed');
    }).finally(function () {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  function scheduleRefresh(reason, delay) {
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(function () {
      refreshTimer = null;
      refresh(reason || 'scheduled');
    }, Number.isFinite(Number(delay)) ? Math.max(0, Number(delay)) : 80);
  }

  function listen(target, name, handler) {
    target.addEventListener(name, handler);
    listeners.push(function () { target.removeEventListener(name, handler); });
  }

  function installListeners() {
    if (listeners.length > 0) return;
    listen(window, 'sapori:auth-state-change', function () {
      scheduleRefresh('auth-state-change', 0);
    });
    listen(window, 'sapori:auth-error', function () {
      scheduleRefresh('auth-error', 0);
    });
    listen(window, 'sapori:sync-state', function () {
      scheduleRefresh('sync-state-change', 30);
    });
    listen(window, 'sapori:queue-changed', function () {
      scheduleRefresh('queue-change', 80);
    });
    listen(window, 'online', function () {
      scheduleRefresh('online', 0);
    });
    listen(window, 'offline', function () {
      scheduleRefresh('offline', 0);
    });
  }

  function initialize() {
    if (initializationPromise) return initializationPromise;
    initialized = true;
    installListeners();

    initializationPromise = (async function () {
      await refresh('local-ready');
      if (window.AuthService && typeof window.AuthService.initialize === 'function') {
        await window.AuthService.initialize();
      }
      if (window.SyncEngine && typeof window.SyncEngine.initialize === 'function') {
        await window.SyncEngine.initialize();
      }
      return refresh('cloud-ready');
    })().catch(function (error) {
      console.warn('Servizi account non disponibili; il ricettario resta locale.');
      return publish({
        ...state,
        status: state.prepared ? 'error' : state.status,
        lastError: safeError(error, 'I servizi cloud non sono disponibili in questo momento.')
      }, 'initialization-failed');
    });

    return initializationPromise;
  }

  function setBusy(button, busy, label) {
    if (!button || !button.isConnected) return;
    if (busy) {
      if (!button.dataset.accountLabel) button.dataset.accountLabel = button.textContent;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      if (label) button.textContent = label;
      return;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.accountLabel) {
      button.textContent = button.dataset.accountLabel;
      delete button.dataset.accountLabel;
    }
    var dynamicRoot = button.closest('[data-account-status-root]');
    if (dynamicRoot && dynamicRoot._pendingAccountStatus &&
        window.AccountView && typeof window.AccountView.updateStatus === 'function') {
      window.AccountView.updateStatus(document, dynamicRoot._pendingAccountStatus);
    }
  }

  function toast(message, type) {
    if (window.Utils && typeof window.Utils.showToast === 'function') {
      window.Utils.showToast(message, type || 'info');
    }
  }

  async function prepareDevice(button) {
    setBusy(button, true, 'Preparazione in corso…');
    try {
      await window.SyncPreparation.prepareDevice();
      if (window.SyncEngine && typeof window.SyncEngine.refreshState === 'function') {
        await window.SyncEngine.refreshState('device-prepared');
      }
      var value = await refresh('device-prepared');
      toast('Dispositivo preparato: le ricette restano locali finché non accedi.', 'success');
      return value;
    } catch (error) {
      toast('Impossibile preparare la sincronizzazione.', 'error');
      throw error;
    } finally {
      setBusy(button, false);
    }
  }

  async function signInWithGoogle(button) {
    setBusy(button, true, 'Apertura di Google…');
    try {
      var current = await refresh('before-sign-in');
      if (!current.prepared) await window.SyncPreparation.prepareDevice();
      return await window.AuthService.signInWithGoogle({ returnHash: '#account' });
    } catch (error) {
      var normalized = safeError(error, 'Non è stato possibile aprire l’accesso Google.');
      toast(normalized.message, normalized.retryable ? 'warning' : 'error');
      await refresh('sign-in-failed');
      throw error;
    } finally {
      setBusy(button, false);
    }
  }

  async function syncNow(button) {
    setBusy(button, true, 'Sincronizzazione…');
    try {
      var current = await refresh('before-manual-sync');
      if (!current.prepared) {
        throw new Error('Prepara prima questo dispositivo.');
      }
      if (!current.authenticated) {
        throw new Error('Accedi prima con Google.');
      }
      if (!current.online) {
        var offlineError = new Error('Sei offline. Le modifiche restano nella coda locale.');
        offlineError.code = 'offline';
        offlineError.category = 'offline';
        offlineError.retryable = true;
        throw offlineError;
      }
      var result = await window.SyncEngine.runNow();
      var value = await refresh('manual-sync-completed');
      if (value.status === 'error') {
        throw value.lastError || new Error('Sincronizzazione non completata.');
      }
      if (value.status === 'offline') {
        var interruptedError = new Error('Connessione interrotta. Le modifiche restano nella coda locale.');
        interruptedError.code = 'offline';
        interruptedError.category = 'offline';
        interruptedError.retryable = true;
        throw interruptedError;
      }
      toast(
        value.conflictCount > 0
          ? 'Sincronizzazione completata conservando entrambe le versioni in conflitto.'
          : value.pendingCount > 0
          ? 'Sincronizzazione avviata: alcune modifiche sono ancora in coda.'
          : 'Ricette sincronizzate.',
        value.conflictCount > 0 ? 'warning' : value.pendingCount > 0 ? 'info' : 'success'
      );
      return result;
    } catch (error) {
      var normalized = safeError(error, 'Non è stato possibile sincronizzare le ricette.');
      toast(normalized.message, normalized.retryable ? 'warning' : 'error');
      await refresh('manual-sync-failed');
      throw error;
    } finally {
      setBusy(button, false);
    }
  }

  async function signOut(button) {
    setBusy(button, true, 'Disconnessione…');
    try {
      await window.AuthService.signOut({ everywhere: false });
      var value = await refresh('signed-out');
      toast('Account disconnesso da questo dispositivo. Le ricette locali restano disponibili.', 'success');
      return value;
    } catch (error) {
      var normalized = safeError(error, 'Non è stato possibile disconnettere l’account.');
      toast(normalized.message, normalized.retryable ? 'warning' : 'error');
      await refresh('sign-out-failed');
      throw error;
    } finally {
      setBusy(button, false);
    }
  }

  function destroy() {
    listeners.splice(0).forEach(function (remove) { remove(); });
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = null;
    refreshPromise = null;
    initializationPromise = null;
    initialized = false;
    state = createEmptyState();
  }

  window.AccountController = Object.freeze({
    EVENTS: EVENTS,
    initialize: initialize,
    refresh: refresh,
    getSnapshot: snapshot,
    prepareDevice: prepareDevice,
    signInWithGoogle: signInWithGoogle,
    syncNow: syncNow,
    retrySync: syncNow,
    signOut: signOut,
    isInitialized: function () { return initialized; },
    destroy: destroy
  });
})();
