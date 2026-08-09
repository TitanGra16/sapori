/**
 * Istanza condivisa del client Supabase per l'app vanilla.
 *
 * Il modulo non carica dipendenze dalla rete e non avvia richieste quando la
 * configurazione è incompleta. La libreria browser di @supabase/supabase-js
 * dovrà esporre window.supabase.createClient prima di questo file.
 */
(function () {
  'use strict';

  var client = null;

  function ConfigurationError(code, message) {
    this.name = 'SupabaseConfigurationError';
    this.code = code;
    this.message = message;
    this.retryable = false;
    if (Error.captureStackTrace) Error.captureStackTrace(this, ConfigurationError);
  }
  ConfigurationError.prototype = Object.create(Error.prototype);
  ConfigurationError.prototype.constructor = ConfigurationError;

  function getConfigurationModule() {
    return window.SaporiSupabaseConfig || null;
  }

  function getConfiguration() {
    var module = getConfigurationModule();
    return module && module.value ? module.value : null;
  }

  function getLibrary() {
    return window.supabase && typeof window.supabase.createClient === 'function'
      ? window.supabase
      : null;
  }

  function getStatus() {
    var module = getConfigurationModule();
    var configuration = getConfiguration();
    var libraryReady = Boolean(getLibrary());

    if (!module || !configuration) {
      return Object.freeze({
        state: 'configuration-missing',
        ready: false,
        configured: false,
        libraryReady: libraryReady,
        reason: 'configuration-missing'
      });
    }

    var configurationStatus = typeof module.getStatus === 'function'
      ? module.getStatus()
      : { enabled: configuration.enabled === true, reason: null };

    if (!configurationStatus.enabled) {
      return Object.freeze({
        state: 'disabled',
        ready: false,
        configured: false,
        libraryReady: libraryReady,
        reason: configurationStatus.reason || 'configuration-disabled'
      });
    }

    if (!libraryReady) {
      return Object.freeze({
        state: 'dependency-missing',
        ready: false,
        configured: true,
        libraryReady: false,
        reason: 'supabase-js-missing'
      });
    }

    return Object.freeze({
      state: 'ready',
      ready: true,
      configured: true,
      libraryReady: true,
      reason: null
    });
  }

  function errorForStatus(status) {
    if (status.reason === 'missing-publishable-key') {
      return new ConfigurationError(
        'missing-publishable-key',
        'La sincronizzazione non è ancora configurata su questo sito.'
      );
    }
    if (status.state === 'dependency-missing') {
      return new ConfigurationError(
        'supabase-js-missing',
        'Il componente necessario per l’accesso cloud non è disponibile.'
      );
    }
    return new ConfigurationError(
      status.reason || status.state,
      'La configurazione Supabase non è disponibile.'
    );
  }

  function getClient() {
    if (client) return client;

    var status = getStatus();
    if (!status.ready) throw errorForStatus(status);

    var configuration = getConfiguration();
    client = getLibrary().createClient(
      configuration.projectUrl,
      configuration.publishableKey,
      {
        auth: {
          flowType: 'pkce',
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          storageKey: configuration.auth.storageKey
        },
        global: {
          headers: {
            'X-Client-Info': 'sapori-web'
          }
        }
      }
    );
    return client;
  }

  function getClientOrNull() {
    try {
      return getClient();
    } catch (error) {
      return null;
    }
  }

  window.SaporiSupabaseClient = Object.freeze({
    ConfigurationError: ConfigurationError,
    getStatus: getStatus,
    getClient: getClient,
    getClientOrNull: getClientOrNull
  });
})();
