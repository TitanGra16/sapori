/**
 * Operazioni di autenticazione di Sapori.
 *
 * Espone un accesso Google con PKCE, logout locale e rinnovo della sessione.
 * Gli errori restituiti all'interfaccia sono classificati e non includono
 * token, URL OAuth completi o dettagli sensibili provenienti dal provider.
 */
(function () {
  'use strict';

  var EVENTS = Object.freeze({
    ACTION: 'sapori:auth-action',
    ERROR: 'sapori:auth-error'
  });

  function AuthServiceError(details, cause) {
    details = details || {};
    this.name = 'AuthServiceError';
    this.code = details.code || 'auth-error';
    this.category = details.category || 'unknown';
    this.message = details.message || 'Accesso cloud non disponibile.';
    this.retryable = details.retryable === true;
    this.status = Number.isFinite(Number(details.status))
      ? Number(details.status)
      : null;
    if (cause) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        enumerable: false,
        value: cause
      });
    }
    if (Error.captureStackTrace) Error.captureStackTrace(this, AuthServiceError);
  }
  AuthServiceError.prototype = Object.create(Error.prototype);
  AuthServiceError.prototype.constructor = AuthServiceError;

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

  function safeCode(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 100);
  }

  function isOffline() {
    return Boolean(window.navigator && window.navigator.onLine === false);
  }

  function hasMessage(error, pattern) {
    return typeof (error && error.message) === 'string' && pattern.test(error.message);
  }

  function classifyError(error, context) {
    if (error instanceof AuthServiceError) return error;

    context = context || {};
    var code = safeCode(error && error.code) || safeCode(context.code) || 'auth-error';
    var status = Number(error && error.status);
    var offline = isOffline();
    var networkFailure = offline ||
      (error && error.name === 'TypeError' && hasMessage(error, /fetch|network|load/i)) ||
      hasMessage(error, /failed to fetch|network(?:error| request)|load failed/i);
    var cancelled = error && error.name === 'AbortError';
    var rateLimited = status === 429 || [
      'over_request_rate_limit',
      'over_email_send_rate_limit',
      'rate_limit_exceeded'
    ].indexOf(code) !== -1;
    var expired = status === 401 || [
      'bad_oauth_state',
      'flow_state_expired',
      'flow_state_not_found',
      'refresh_token_not_found',
      'refresh_token_already_used',
      'session_not_found'
    ].indexOf(code) !== -1;
    var forbidden = status === 403 || [
      'user_banned',
      'email_not_confirmed'
    ].indexOf(code) !== -1;
    var configuration = [
      'configuration-missing',
      'configuration-disabled',
      'invalid-project-url',
      'missing-publishable-key',
      'oauth_provider_not_supported',
      'supabase-js-missing',
      'auth-client-missing',
      'unsupported-origin'
    ].indexOf(code) !== -1;

    if (configuration) {
      return new AuthServiceError({
        code: code,
        category: 'configuration',
        message: 'La sincronizzazione cloud non è ancora configurata.',
        retryable: false,
        status: status
      }, error);
    }
    if (networkFailure) {
      return new AuthServiceError({
        code: offline ? 'offline' : 'network-error',
        category: offline ? 'offline' : 'network',
        message: offline
          ? 'Sei offline. Le ricette locali restano disponibili.'
          : 'Non è stato possibile raggiungere il servizio cloud.',
        retryable: true,
        status: status
      }, error);
    }
    if (cancelled) {
      return new AuthServiceError({
        code: 'auth-cancelled',
        category: 'cancelled',
        message: 'Accesso annullato.',
        retryable: true,
        status: status
      }, error);
    }
    if (rateLimited) {
      return new AuthServiceError({
        code: code,
        category: 'rate-limit',
        message: 'Troppi tentativi ravvicinati. Riprova tra qualche minuto.',
        retryable: true,
        status: status
      }, error);
    }
    if (expired) {
      return new AuthServiceError({
        code: code,
        category: 'session-expired',
        message: 'La sessione è scaduta. Accedi nuovamente.',
        retryable: true,
        status: status
      }, error);
    }
    if (forbidden) {
      return new AuthServiceError({
        code: code,
        category: 'forbidden',
        message: 'Questo account non può accedere alla sincronizzazione.',
        retryable: false,
        status: status
      }, error);
    }
    if (status >= 500 || code === 'unexpected_failure') {
      return new AuthServiceError({
        code: code,
        category: 'service',
        message: 'Il servizio cloud è temporaneamente indisponibile.',
        retryable: true,
        status: status
      }, error);
    }

    return new AuthServiceError({
      code: code,
      category: context.category || 'unknown',
      message: context.message || 'Non è stato possibile completare l’accesso.',
      retryable: false,
      status: status
    }, error);
  }

  function publicError(error) {
    return Object.freeze({
      code: error.code,
      category: error.category,
      message: error.message,
      retryable: error.retryable,
      status: error.status
    });
  }

  function emitAction(action, phase) {
    dispatch(EVENTS.ACTION, Object.freeze({
      action: action,
      phase: phase,
      at: Date.now()
    }));
  }

  function emitError(action, error) {
    dispatch(EVENTS.ERROR, Object.freeze({
      action: action,
      error: publicError(error),
      at: Date.now()
    }));
  }

  function applicationDirectory() {
    var pathname = window.location && typeof window.location.pathname === 'string'
      ? window.location.pathname
      : '/';
    if (!pathname.endsWith('/')) {
      pathname = pathname.slice(0, pathname.lastIndexOf('/') + 1) || '/';
    }
    return pathname;
  }

  function normalizeReturnHash(value) {
    if (typeof value !== 'string' || !/^#[a-z0-9][a-z0-9/_-]{0,80}$/i.test(value)) {
      return '#account';
    }
    return value;
  }

  function getRedirectUrl(returnHash) {
    if (!window.location ||
        (window.location.protocol !== 'https:' && window.location.protocol !== 'http:')) {
      throw new AuthServiceError({
        code: 'unsupported-origin',
        category: 'configuration',
        message: 'L’accesso cloud richiede il sito pubblicato tramite HTTPS.',
        retryable: false
      });
    }
    var redirect = new URL(applicationDirectory(), window.location.origin);
    redirect.hash = normalizeReturnHash(returnHash);
    return redirect.toString();
  }

  function requireClient(options) {
    options = options || {};
    if (!window.SaporiSupabaseClient) {
      throw classifyError({ code: 'auth-client-missing' });
    }

    var readiness = window.SaporiSupabaseClient.getStatus();
    if (!readiness.ready) {
      throw classifyError({ code: readiness.reason || readiness.state });
    }
    if (options.networkRequired && isOffline()) {
      throw classifyError({ code: 'offline' });
    }
    return window.SaporiSupabaseClient.getClient();
  }

  async function runAction(action, operation) {
    emitAction(action, 'started');
    try {
      var result = await operation();
      emitAction(action, result && result.status === 'redirecting' ? 'redirecting' : 'completed');
      return result;
    } catch (error) {
      var classified = classifyError(error, { category: action });
      emitAction(action, 'failed');
      emitError(action, classified);
      throw classified;
    }
  }

  async function initialize() {
    var callbackError = getOAuthCallbackError();
    if (callbackError) emitError('oauth-callback', callbackError);

    if (!window.AuthSession) {
      var missing = classifyError({ code: 'auth-client-missing' });
      emitError('initialize', missing);
      return Object.freeze({
        initialized: true,
        status: 'unavailable',
        configured: false,
        online: !isOffline(),
        authenticated: false,
        user: null,
        expiresAt: null,
        authEvent: null,
        error: publicError(missing),
        updatedAt: Date.now()
      });
    }
    return window.AuthSession.initialize();
  }

  function signInWithGoogle(options) {
    options = options || {};
    return runAction('sign-in', async function () {
      var client = requireClient({ networkRequired: true });
      var redirectTo = getRedirectUrl(options.returnHash);
      var response = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectTo,
          scopes: 'openid email profile',
          skipBrowserRedirect: options.skipBrowserRedirect === true
        }
      });
      if (response.error) throw response.error;

      return Object.freeze({
        status: 'redirecting',
        provider: 'google',
        redirectTo: redirectTo,
        url: options.skipBrowserRedirect === true && response.data
          ? response.data.url || null
          : null
      });
    });
  }

  function signOut(options) {
    options = options || {};
    return runAction('sign-out', async function () {
      var scope = options.everywhere === true ? 'global' : 'local';
      var client = requireClient({ networkRequired: scope === 'global' });
      var response = await client.auth.signOut({ scope: scope });
      if (response.error) throw response.error;
      if (window.AuthSession) await window.AuthSession.refreshFromClient();
      return Object.freeze({ status: 'signed-out', scope: scope });
    });
  }

  function refreshSession() {
    return runAction('refresh-session', async function () {
      var client = requireClient({ networkRequired: true });
      var response = await client.auth.refreshSession();
      if (response.error) throw response.error;
      if (window.AuthSession) await window.AuthSession.refreshFromClient();
      return Object.freeze({
        status: response.data && response.data.session ? 'authenticated' : 'anonymous'
      });
    });
  }

  function callbackParameters() {
    var values = new URLSearchParams(window.location.search || '');
    var hash = window.location.hash || '';
    if (hash.indexOf('=') !== -1) {
      var hashValues = new URLSearchParams(hash.replace(/^#/, ''));
      hashValues.forEach(function (value, key) {
        if (!values.has(key)) values.set(key, value);
      });
    }
    return values;
  }

  function getOAuthCallbackError() {
    var parameters = callbackParameters();
    var providerError = parameters.get('error');
    var providerCode = parameters.get('error_code');
    if (!providerError && !providerCode) return null;

    return classifyError({
      code: safeCode(providerCode || providerError) || 'oauth-callback-error',
      status: null
    }, {
      category: 'oauth-callback',
      message: 'Google non ha completato l’accesso. Puoi riprovare senza perdere le ricette locali.'
    });
  }

  function getSnapshot() {
    if (!window.AuthSession) {
      return Object.freeze({
        initialized: false,
        status: 'unavailable',
        configured: false,
        online: !isOffline(),
        authenticated: false,
        user: null,
        expiresAt: null,
        authEvent: null,
        error: null,
        updatedAt: Date.now()
      });
    }
    return window.AuthSession.getSnapshot();
  }

  window.AuthService = Object.freeze({
    EVENTS: EVENTS,
    AuthServiceError: AuthServiceError,
    initialize: initialize,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    refreshSession: refreshSession,
    getSnapshot: getSnapshot,
    getRedirectUrl: getRedirectUrl,
    getOAuthCallbackError: getOAuthCallbackError,
    classifyError: classifyError
  });
})();
