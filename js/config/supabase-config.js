/**
 * Configurazione pubblica di Supabase.
 *
 * La publishable key e il Project URL sono dati pensati per il browser: la
 * protezione dei dati dipende dalle policy RLS, non dal tentativo di nascondere
 * questa chiave. In questo file non devono mai comparire service_role,
 * sb_secret_*, password del database o segreti OAuth.
 */
(function () {
  'use strict';

  var PROJECT_REF = 'jzezzwvvcawwonmjaeie';
  var PROJECT_URL = 'https://' + PROJECT_REF + '.supabase.co';

  // Da compilare esclusivamente con la chiave che inizia con sb_publishable_.
  // Finché resta vuota ogni modulo cloud rimane disattivato in modo sicuro.
  var PUBLISHABLE_KEY = '';

  function isValidProjectUrl(value) {
    if (typeof value !== 'string' || !value) return false;

    try {
      var url = new URL(value);
      return url.protocol === 'https:' &&
        url.username === '' &&
        url.password === '' &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === '' &&
        url.hostname === PROJECT_REF + '.supabase.co';
    } catch (error) {
      return false;
    }
  }

  function isValidPublishableKey(value) {
    return typeof value === 'string' &&
      /^sb_publishable_[A-Za-z0-9._-]{16,}$/.test(value.trim());
  }

  var projectUrlValid = isValidProjectUrl(PROJECT_URL);
  var publishableKeyValid = isValidPublishableKey(PUBLISHABLE_KEY);
  var configuration = Object.freeze({
    projectRef: PROJECT_REF,
    projectUrl: PROJECT_URL,
    publishableKey: PUBLISHABLE_KEY.trim(),
    enabled: projectUrlValid && publishableKeyValid,
    auth: Object.freeze({
      provider: 'google',
      flowType: 'pkce',
      storageKey: 'sapori-auth-' + PROJECT_REF
    })
  });

  function getStatus() {
    var reason = null;
    if (!projectUrlValid) reason = 'invalid-project-url';
    else if (!publishableKeyValid) reason = 'missing-publishable-key';

    return Object.freeze({
      enabled: configuration.enabled,
      reason: reason,
      projectRef: configuration.projectRef,
      projectUrl: configuration.projectUrl,
      hasPublishableKey: publishableKeyValid
    });
  }

  window.SaporiSupabaseConfig = Object.freeze({
    value: configuration,
    getStatus: getStatus,
    isReady: function () { return configuration.enabled; }
  });
})();
