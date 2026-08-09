/**
 * Stato della sessione Supabase, indipendente dall'interfaccia.
 *
 * La sessione cloud non è mai un requisito per aprire Sapori: configurazione
 * assente, rete non disponibile o sessione scaduta vengono rappresentate nello
 * stato, senza bloccare l'archivio locale.
 */
(function () {
  'use strict';

  var EVENTS = Object.freeze({
    STATE_CHANGE: 'sapori:auth-state-change',
    ERROR: 'sapori:auth-error'
  });
  var currentSession = null;
  var authSubscription = null;
  var initializationPromise = null;
  var networkListenersInstalled = false;
  var state = {
    initialized: false,
    status: 'idle',
    configured: false,
    online: isOnline(),
    user: null,
    expiresAt: null,
    authEvent: null,
    error: null,
    updatedAt: Date.now()
  };

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

  function dispatch(name, detail) {
    if (typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(createEvent(name, detail));
  }

  function text(value, maximum) {
    if (typeof value !== 'string') return null;
    var normalized = value.trim();
    return normalized ? normalized.slice(0, maximum) : null;
  }

  function publicUser(user) {
    if (!user || typeof user !== 'object') return null;
    var metadata = user.user_metadata || {};
    return Object.freeze({
      id: text(user.id, 100),
      email: text(user.email, 320),
      displayName: text(
        metadata.full_name || metadata.name || metadata.user_name,
        160
      ),
      avatarUrl: text(metadata.avatar_url || metadata.picture, 2048),
      lastSignInAt: text(user.last_sign_in_at, 100)
    });
  }

  function publicError(error) {
    if (!error) return null;
    return Object.freeze({
      code: text(error.code, 100) || 'auth-error',
      category: text(error.category, 100) || 'unknown',
      message: text(error.message, 300) || 'Accesso cloud non disponibile.',
      retryable: error.retryable === true
    });
  }

  function snapshot() {
    return Object.freeze({
      initialized: state.initialized,
      status: state.status,
      configured: state.configured,
      online: state.online,
      authenticated: state.status === 'authenticated' && Boolean(state.user),
      user: state.user,
      expiresAt: state.expiresAt,
      authEvent: state.authEvent,
      error: state.error,
      updatedAt: state.updatedAt
    });
  }

  function update(changes, reason) {
    state = {
      ...state,
      ...changes,
      updatedAt: Date.now()
    };
    var value = snapshot();
    dispatch(EVENTS.STATE_CHANGE, Object.freeze({
      reason: reason || 'state-change',
      state: value
    }));
    return value;
  }

  function sessionExpiry(session) {
    var seconds = Number(session && session.expires_at);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
  }

  function applySession(session, authEvent) {
    currentSession = session || null;
    return update({
      initialized: true,
      status: session && session.user ? 'authenticated' : 'anonymous',
      configured: true,
      online: isOnline(),
      user: publicUser(session && session.user),
      expiresAt: sessionExpiry(session),
      authEvent: authEvent || null,
      error: null
    }, authEvent || 'session-read');
  }

  function normalizeInitializationError(error) {
    var code = text(error && error.code, 100) || 'auth-initialization-failed';
    var offline = !isOnline() || code === 'network-error';
    return {
      code: code,
      category: offline ? 'offline' : 'initialization',
      message: offline
        ? 'Nessuna connessione: le ricette locali restano disponibili.'
        : 'Non è stato possibile inizializzare l’accesso cloud.',
      retryable: offline || (error && error.retryable === true)
    };
  }

  function reportError(error, reason) {
    var normalized = publicError(normalizeInitializationError(error));
    var value = update({
      initialized: true,
      status: currentSession && currentSession.user ? 'authenticated' : 'unavailable',
      configured: Boolean(
        window.SaporiSupabaseClient &&
        window.SaporiSupabaseClient.getStatus().configured
      ),
      online: isOnline(),
      user: publicUser(currentSession && currentSession.user),
      expiresAt: sessionExpiry(currentSession),
      authEvent: null,
      error: normalized
    }, reason || 'session-error');
    dispatch(EVENTS.ERROR, Object.freeze({
      action: 'session',
      error: normalized
    }));
    return value;
  }

  function handleNetworkChange() {
    update({ online: isOnline() }, isOnline() ? 'online' : 'offline');
  }

  function installNetworkListeners() {
    if (networkListenersInstalled || typeof window.addEventListener !== 'function') return;
    window.addEventListener('online', handleNetworkChange);
    window.addEventListener('offline', handleNetworkChange);
    networkListenersInstalled = true;
  }

  function subscribe(client) {
    if (authSubscription) return;
    var response = client.auth.onAuthStateChange(function (event, session) {
      // Il callback resta sincrono: chiamare altre API Supabase qui potrebbe
      // bloccare il lock interno usato dal client per aggiornare la sessione.
      window.setTimeout(function () {
        applySession(session, event || 'AUTH_STATE_CHANGED');
      }, 0);
    });
    authSubscription = response && response.data
      ? response.data.subscription
      : null;
  }

  async function initialize() {
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async function () {
      installNetworkListeners();

      if (!window.SaporiSupabaseClient) {
        return reportError(
          { code: 'auth-client-missing', retryable: false },
          'client-missing'
        );
      }

      var readiness = window.SaporiSupabaseClient.getStatus();
      if (!readiness.ready) {
        var disabled = readiness.state === 'disabled' ||
          readiness.state === 'configuration-missing';
        return update({
          initialized: true,
          status: disabled ? 'disabled' : 'unavailable',
          configured: readiness.configured,
          online: isOnline(),
          user: null,
          expiresAt: null,
          authEvent: null,
          error: disabled ? null : publicError({
            code: readiness.reason,
            category: 'dependency',
            message: 'Il componente per l’accesso cloud non è disponibile.',
            retryable: false
          })
        }, disabled ? 'configuration-disabled' : 'dependency-missing');
      }

      update({
        status: 'initializing',
        configured: true,
        online: isOnline(),
        error: null
      }, 'initializing');

      try {
        var client = window.SaporiSupabaseClient.getClient();
        subscribe(client);
        var response = await client.auth.getSession();
        if (response.error) throw response.error;
        return applySession(response.data && response.data.session, 'INITIAL_SESSION');
      } catch (error) {
        return reportError(error, 'initialization-failed');
      }
    })();

    return initializationPromise;
  }

  async function refreshFromClient() {
    if (!window.SaporiSupabaseClient) return initialize();
    var readiness = window.SaporiSupabaseClient.getStatus();
    if (!readiness.ready) return initialize();

    try {
      var response = await window.SaporiSupabaseClient.getClient().auth.getSession();
      if (response.error) throw response.error;
      return applySession(response.data && response.data.session, 'SESSION_REFRESHED');
    } catch (error) {
      return reportError(error, 'session-refresh-failed');
    }
  }

  function destroy() {
    if (authSubscription && typeof authSubscription.unsubscribe === 'function') {
      authSubscription.unsubscribe();
    }
    if (networkListenersInstalled && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', handleNetworkChange);
      window.removeEventListener('offline', handleNetworkChange);
    }
    authSubscription = null;
    initializationPromise = null;
    networkListenersInstalled = false;
    currentSession = null;
    state = {
      initialized: false,
      status: 'idle',
      configured: false,
      online: isOnline(),
      user: null,
      expiresAt: null,
      authEvent: null,
      error: null,
      updatedAt: Date.now()
    };
  }

  window.AuthSession = Object.freeze({
    EVENTS: EVENTS,
    initialize: initialize,
    refreshFromClient: refreshFromClient,
    getSnapshot: snapshot,
    getSession: function () { return currentSession; },
    destroy: destroy
  });
})();
