/**
 * Vista Account e sincronizzazione.
 *
 * Tutti i valori provenienti dall'account o dagli errori vengono neutralizzati
 * prima di entrare nell'HTML. Gli aggiornamenti sostituiscono soltanto le aree
 * dedicate allo stato account, senza ridisegnare gli altri form della pagina.
 */
(function () {
  'use strict';

  var cloudIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H6a4 4 0 0 1-.45-7.97A6.5 6.5 0 0 1 18.1 9.2 4.9 4.9 0 0 1 17.5 19Z"/></svg>';
  var deviceIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 18h6"/></svg>';
  var accountIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  var queueIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r=".5" fill="currentColor"/><circle cx="3.5" cy="12" r=".5" fill="currentColor"/><circle cx="3.5" cy="18" r=".5" fill="currentColor"/></svg>';

  function escapeHtml(value) {
    if (window.Utils && typeof window.Utils.escapeHtml === 'function') {
      return window.Utils.escapeHtml(String(value === null || value === undefined ? '' : value));
    }
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function plural(value, singular, pluralForm) {
    var count = Number(value) || 0;
    return count + ' ' + (count === 1 ? singular : pluralForm);
  }

  function formatDate(value, emptyText) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
      return emptyText || 'Mai';
    }
    return new Date(Number(value)).toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function normalizeStatus(status) {
    status = status || {};
    var prepared = status.prepared === true || status.preparationEnabled === true;
    var authenticated = status.authenticated === true;
    var bound = status.bound === true || Boolean(
      authenticated && status.accountId && status.user && status.user.id === status.accountId
    );
    var online = status.online !== false &&
      (!window.navigator || window.navigator.onLine !== false);
    var inferredStatus = !prepared
      ? 'not-prepared'
      : status.configured === true
        ? 'auth-required'
        : 'not-configured';
    var normalized = {
      ...status,
      status: status.status || inferredStatus,
      prepared: prepared,
      authenticated: authenticated,
      configured: status.configured === true,
      bound: bound,
      online: online,
      syncing: status.syncing === true || status.status === 'syncing',
      pendingCount: Number(status.pendingCount) || 0,
      pendingRecipeCount: Number(status.pendingRecipeCount) || 0,
      sendingCount: Number(status.sendingCount) || 0,
      blockedCount: Number(status.blockedCount) || 0,
      conflictCount: Number(status.conflictCount) || 0,
      recipeCount: Number(status.recipeCount) || 0,
      lastSyncAt: Number(status.lastSyncAt) || null,
      preparedAt: Number(status.preparedAt) || null,
      lastError: status.lastError || null,
      user: status.user || null
    };
    return normalized;
  }

  function stateContent(status) {
    var states = {
      'not-prepared': {
        tone: 'local',
        badge: 'Solo su questo dispositivo',
        title: 'Prepara Sapori alla sincronizzazione',
        text: 'Crea una coda locale delle ricette senza inviare nulla online. Potrai collegare Google nel passaggio successivo.'
      },
      'not-configured': {
        tone: 'warning',
        badge: 'Cloud non configurato',
        title: 'Il ricettario locale è pronto',
        text: 'La configurazione Supabase non è ancora completa. Puoi continuare a usare tutte le funzioni offline senza perdere dati.'
      },
      initializing: {
        tone: 'progress',
        badge: 'Controllo account',
        title: 'Verifico la sessione in modo sicuro',
        text: 'Il ricettario è già disponibile. Il controllo cloud prosegue in sottofondo e non blocca l’app.'
      },
      'auth-required': {
        tone: 'ready',
        badge: 'Dispositivo preparato',
        title: 'Accedi per usare più dispositivi',
        text: 'Collega il tuo account Google. Le ricette locali saranno associate solo dopo il primo avvio manuale della sincronizzazione.'
      },
      'binding-required': {
        tone: 'ready',
        badge: 'Account autenticato',
        title: 'Collega questo ricettario al tuo account',
        text: 'Avvia la prima sincronizzazione per associare in modo sicuro il profilo locale e caricare le modifiche in coda.'
      },
      'account-mismatch': {
        tone: 'error',
        badge: 'Account diverso',
        title: 'Usa l’account già associato',
        text: status.lastError && status.lastError.message
          ? String(status.lastError.message)
          : 'Questo dispositivo è già associato a un altro account.'
      },
      offline: {
        tone: 'offline',
        badge: 'Modalità offline',
        title: 'Le ricette restano disponibili',
        text: 'Le nuove modifiche vengono conservate nella coda locale e ripartiranno quando tornerà la connessione.'
      },
      syncing: {
        tone: 'progress',
        badge: 'Sincronizzazione in corso',
        title: 'Sto aggiornando il tuo ricettario',
        text: 'Invio e recupero le sole modifiche necessarie. Puoi continuare a usare l’app.'
      },
      error: {
        tone: 'error',
        badge: 'Serve attenzione',
        title: 'La sincronizzazione non è completa',
        text: status.lastError && status.lastError.message
          ? String(status.lastError.message)
          : 'Alcune modifiche non sono state inviate. Le ricette locali non sono a rischio.'
      },
      conflict: {
        tone: 'warning',
        badge: 'Conflitto rilevato',
        title: 'Ho conservato entrambe le versioni',
        text: 'Sapori ha creato copie separate delle ricette modificate su più dispositivi, così puoi confrontarle senza perdere contenuti.'
      },
      pending: {
        tone: 'pending',
        badge: 'Modifiche in coda',
        title: 'Ci sono aggiornamenti da sincronizzare',
        text: 'Le modifiche sono al sicuro sul dispositivo e verranno inviate al prossimo ciclo disponibile.'
      },
      synced: {
        tone: 'success',
        badge: 'Sincronizzazione aggiornata',
        title: 'Il ricettario è sincronizzato',
        text: 'Le modifiche di questo account risultano aggiornate tra i dispositivi collegati.'
      },
      ready: {
        tone: 'ready',
        badge: 'Pronto a sincronizzare',
        title: 'Il collegamento è attivo',
        text: 'Avvia la prima sincronizzazione per verificare e aggiornare il ricettario cloud.'
      }
    };
    return states[status.status] || states.ready;
  }

  function primaryAction(status) {
    if (!status.prepared) {
      return '<button type="button" class="btn btn--primary account-primary-action" data-action="prepare-sync">Prepara questo dispositivo</button>';
    }
    if (!status.configured || status.status === 'initializing') return '';
    if (!status.authenticated) {
      return '<button type="button" class="btn btn--primary account-primary-action" data-action="login-google"' +
        (status.online ? '' : ' disabled') + '>Accedi con Google</button>';
    }
    if (status.status === 'account-mismatch') return '';
    if (status.status === 'error' && status.blockedCount === 0 &&
        status.lastError && status.lastError.retryable !== true) {
      return '';
    }
    var action = status.status === 'error' ? 'retry-sync' : 'sync-now';
    var label = status.status === 'binding-required'
      ? 'Collega e sincronizza'
      : status.status === 'error'
        ? 'Riprova sincronizzazione'
        : 'Sincronizza ora';
    return '<button type="button" class="btn btn--primary account-primary-action" data-action="' + action + '"' +
      (!status.online || status.syncing ? ' disabled' : '') + '>' + label + '</button>';
  }

  function settingsCardInner(status) {
    status = normalizeStatus(status);
    var content = stateContent(status);
    var description;
    if (!status.prepared) {
      description = 'Prepara una coda locale sicura prima di collegare il tuo account.';
    } else if (status.authenticated && status.bound) {
      description = status.syncing
        ? 'Sincronizzazione in corso. Puoi continuare a usare l’app.'
        : plural(status.pendingCount, 'modifica in coda', 'modifiche in coda') +
          ' · Ultimo aggiornamento: ' + formatDate(status.lastSyncAt, 'non ancora eseguito') + '.';
    } else if (status.authenticated) {
      description = 'Account connesso: completa il collegamento del ricettario locale.';
    } else {
      description = plural(status.pendingCount, 'modifica locale pronta', 'modifiche locali pronte') +
        '. Accedi per sincronizzarle.';
    }
    return '' +
      '<div class="settings-card__header">' +
        '<span class="settings-card__icon settings-card__icon--sync">' + cloudIcon + '</span>' +
        '<h2 class="settings-card__title" id="settings-sync-title">Account e sincronizzazione</h2>' +
      '</div>' +
      '<div class="settings-card__body">' +
        '<div class="sync-settings-summary">' +
          '<div class="sync-settings-summary__copy">' +
            '<span class="sync-status-pill sync-status-pill--' + escapeHtml(content.tone) + '">' + escapeHtml(content.badge) + '</span>' +
            '<h3>' + escapeHtml(content.title) + '</h3>' +
            '<p>' + escapeHtml(description) + '</p>' +
          '</div>' +
          '<button type="button" class="btn btn--secondary sync-settings-summary__action" data-action="go-account">Gestisci account</button>' +
        '</div>' +
      '</div>';
  }

  function renderSettingsCard(status) {
    return '<section class="settings-card settings-card--sync" aria-labelledby="settings-sync-title" data-account-settings-status>' +
      settingsCardInner(status) +
      '</section>';
  }

  function step(marker, title, text, stateName) {
    var markerHtml = stateName === 'done' && window.Icons ? window.Icons.check : marker;
    return '<li class="account-step account-step--' + stateName + '">' +
      '<span class="account-step__marker">' + markerHtml + '</span>' +
      '<div><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(text) + '</span></div>' +
      '</li>';
  }

  function preparationSteps(status) {
    var preparationState = status.prepared ? 'done' : 'current';
    var accountState = status.authenticated ? 'done' : (status.prepared ? 'current' : 'upcoming');
    var syncState = status.bound ? 'done' : (status.authenticated ? 'current' : 'upcoming');
    return '<ol class="account-steps">' +
      step('1', 'Preparazione locale', status.prepared ? 'Completata su questo dispositivo' : 'Crea la coda senza inviare dati', preparationState) +
      step('2', 'Accesso personale', status.authenticated ? 'Account Google autenticato' : 'Collega il tuo account Google', accountState) +
      step('3', 'Più dispositivi', status.bound ? 'Ricettario associato in modo stabile' : 'Avvia il primo collegamento', syncState) +
      '</ol>';
  }

  function userInitials(user) {
    var source = user && (user.displayName || user.email) ? (user.displayName || user.email) : 'A';
    var parts = String(source).trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map(function (part) { return part.charAt(0).toUpperCase(); }).join('') || 'A';
  }

  function accountCard(status) {
    if (!status.authenticated || !status.user) {
      var availability = !status.configured
        ? 'Il servizio cloud deve ancora essere configurato.'
        : status.online
          ? 'Nessun account collegato.'
          : 'Torna online per effettuare l’accesso.';
      return '<section class="account-card account-card--auth" aria-labelledby="cloud-card-title">' +
        '<div class="account-card__heading">' +
          '<span class="account-card__icon">' + accountIcon + '</span>' +
          '<div><h2 id="cloud-card-title">Account personale</h2><p>' + escapeHtml(availability) + '</p></div>' +
        '</div>' +
        '<div class="account-auth-empty">' +
          '<p>Usa Google per riconoscere lo stesso ricettario sui tuoi dispositivi. Sapori non riceve la tua password.</p>' +
          (status.prepared && status.configured
            ? '<button type="button" class="btn btn--secondary account-card__action" data-action="login-google"' +
                (status.online ? '' : ' disabled') + '>Accedi con Google</button>'
            : '') +
        '</div>' +
      '</section>';
    }

    var name = status.user.displayName || 'Account Google';
    var email = status.user.email || 'Email non disponibile';
    return '<section class="account-card account-card--auth" aria-labelledby="cloud-card-title">' +
      '<div class="account-card__heading">' +
        '<span class="account-card__icon">' + accountIcon + '</span>' +
        '<div><h2 id="cloud-card-title">Account personale</h2><p>' +
          (status.bound ? 'Associato a questo ricettario' : 'Autenticato, collegamento da completare') +
        '</p></div>' +
      '</div>' +
      '<div class="account-profile">' +
        '<span class="account-profile__avatar" aria-hidden="true">' + escapeHtml(userInitials(status.user)) + '</span>' +
        '<div class="account-profile__identity"><strong>' + escapeHtml(name) + '</strong><span>' + escapeHtml(email) + '</span></div>' +
      '</div>' +
      '<div class="account-profile__footer">' +
        '<span class="sync-status-pill sync-status-pill--' + (status.bound ? 'success' : 'pending') + '">' +
          (status.bound ? 'Ricettario collegato' : 'Da collegare') +
        '</span>' +
        '<button type="button" class="btn btn--text account-signout" data-action="logout-account">Esci su questo dispositivo</button>' +
      '</div>' +
    '</section>';
  }

  function privacyNote(status) {
    var title;
    var text;
    if (status.authenticated && status.bound) {
      title = 'Sincronizzazione privata per account';
      text = 'Ricette e foto vengono inviate al tuo spazio Supabase tramite HTTPS. Restano disponibili anche nel browser per l’uso offline.';
    } else if (status.prepared) {
      title = 'Nessun invio prima del collegamento';
      text = 'La coda è conservata nel browser. I dati lasciano il dispositivo solo dopo l’accesso e l’avvio della sincronizzazione.';
    } else {
      title = 'Tutto resta su questo dispositivo';
      text = 'La preparazione crea soltanto dati locali e non effettua richieste esterne.';
    }
    return '<aside class="account-privacy-note" aria-label="Privacy della sincronizzazione">' +
      '<span class="account-privacy-note__icon">' + (window.Icons ? window.Icons.shield : '') + '</span>' +
      '<div><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(text) + '</p></div>' +
      '</aside>';
  }

  function dynamicContent(rawStatus) {
    var status = normalizeStatus(rawStatus);
    var content = stateContent(status);
    var errorDetails = status.lastError && status.status === 'error'
      ? '<p class="sync-message sync-message--error" role="alert">' + escapeHtml(status.lastError.message) + '</p>'
      : '';
    var conflictDetails = status.conflictCount > 0
      ? '<p class="sync-message sync-message--warning">' +
          escapeHtml(plural(status.conflictCount, 'conflitto conservato', 'conflitti conservati')) +
        '. Controlla le copie create nel ricettario.</p>'
      : '';

    var html = '<p class="sr-only" role="status" aria-live="polite">' +
      escapeHtml(content.badge + ': ' + content.title) + '</p>';
    html += '<section class="account-hero account-hero--' + escapeHtml(content.tone) + '" aria-labelledby="account-hero-title">';
    html += '<div class="account-hero__icon">' + cloudIcon + '</div>';
    html += '<span class="sync-status-pill sync-status-pill--' + escapeHtml(content.tone) + '">' + escapeHtml(content.badge) + '</span>';
    html += '<h2 id="account-hero-title">' + escapeHtml(content.title) + '</h2>';
    html += '<p>' + escapeHtml(content.text) + '</p>';
    html += errorDetails + conflictDetails;
    html += '<div class="account-hero__action" id="sync-action-status" aria-live="polite">' + primaryAction(status) + '</div>';
    html += '</section>';

    html += '<div class="account-card-grid">';
    html += '<section class="account-card" aria-labelledby="device-card-title">' +
      '<div class="account-card__heading"><span class="account-card__icon">' + deviceIcon + '</span>' +
        '<div><h2 id="device-card-title">Questo dispositivo</h2><p>Dati locali disponibili anche offline</p></div></div>' +
      '<div class="account-metrics">' +
        '<div class="account-metric"><strong>' + status.recipeCount + '</strong><span>' +
          (status.recipeCount === 1 ? 'Ricetta salvata' : 'Ricette salvate') + '</span></div>' +
        '<div class="account-metric"><strong>' + status.pendingCount + '</strong><span>Modifiche nella coda</span></div>' +
      '</div>' +
      '<div class="account-card__note">' + queueIcon + '<span>' +
        escapeHtml(status.prepared
          ? plural(status.pendingRecipeCount, 'ricetta interessata', 'ricette interessate')
          : 'La coda verrà creata dopo la preparazione') +
      '</span></div>' +
    '</section>';
    html += accountCard(status);
    html += '</div>';

    html += '<section class="account-card account-card--sync-details" aria-labelledby="sync-details-title">' +
      '<div class="account-card__heading"><span class="account-card__icon">' + queueIcon + '</span>' +
        '<div><h2 id="sync-details-title">Stato sincronizzazione</h2><p>Dettagli utili senza dati sensibili</p></div></div>' +
      '<dl class="sync-detail-list">' +
        '<div><dt>Connessione</dt><dd><span class="sync-dot sync-dot--' + (status.online ? 'online' : 'offline') + '"></span>' +
          (status.online ? 'Online' : 'Offline') + '</dd></div>' +
        '<div><dt>Operazioni</dt><dd>' + escapeHtml(plural(status.pendingCount, 'in coda', 'in coda')) + '</dd></div>' +
        '<div><dt>Conflitti</dt><dd>' + status.conflictCount + '</dd></div>' +
        '<div><dt>Ultimo aggiornamento</dt><dd>' + escapeHtml(formatDate(status.lastSyncAt, 'Non ancora eseguito')) + '</dd></div>' +
      '</dl>' +
    '</section>';

    html += '<section class="account-card account-card--steps" aria-labelledby="steps-title">' +
      '<div class="account-card__heading"><span class="account-card__icon">' + queueIcon + '</span>' +
        '<div><h2 id="steps-title">Percorso verso più dispositivi</h2><p>Ogni passaggio è separato e controllabile</p></div></div>' +
      preparationSteps(status) +
    '</section>';
    html += privacyNote(status);
    return html;
  }

  async function readStatus() {
    if (window.AccountController && typeof window.AccountController.refresh === 'function') {
      return window.AccountController.refresh('account-view-render');
    }
    return window.SyncPreparation.getStatus();
  }

  async function render(container) {
    var status = await readStatus();
    var html = '<div class="view account-view animate-fade-in">';
    html += '<header class="view-header view-header--back account-header">' +
      '<button type="button" class="btn btn--icon view-back-button" data-action="go-settings" aria-label="Torna alle impostazioni">' +
        (window.Icons ? window.Icons.arrowLeft : '') +
      '</button>' +
      '<div class="account-header__copy">' +
        '<h1 class="view-header__title" id="account-title" tabindex="-1">Account e sincronizzazione</h1>' +
        '<p class="view-header__subtitle">Ricette locali, accesso personale e aggiornamenti tra dispositivi</p>' +
      '</div>' +
    '</header>';
    html += '<div data-account-status-root>' + dynamicContent(status) + '</div>';
    html += '</div>';
    container.innerHTML = html;
  }

  function updateStatus(root, rawStatus) {
    root = root || document;
    var status = normalizeStatus(rawStatus);
    var dynamicRoot = root.querySelector('[data-account-status-root]');
    if (dynamicRoot) {
      var busyButton = dynamicRoot.querySelector('[data-action][aria-busy="true"]');
      if (busyButton) {
        dynamicRoot._pendingAccountStatus = status;
      } else {
        var activeAction = document.activeElement && document.activeElement.getAttribute
          ? document.activeElement.getAttribute('data-action')
          : null;
        dynamicRoot.innerHTML = dynamicContent(status);
        dynamicRoot._pendingAccountStatus = null;
        if (activeAction) {
          var nextActive = dynamicRoot.querySelector('[data-action="' + activeAction + '"]');
          if (nextActive) nextActive.focus({ preventScroll: true });
        }
      }
    }
    var settingsRoot = root.querySelector('[data-account-settings-status]');
    if (settingsRoot) settingsRoot.innerHTML = settingsCardInner(status);
  }

  function focusHeading(container) {
    var root = container || document;
    var heading = root.querySelector('#account-title');
    if (heading) {
      window.requestAnimationFrame(function () {
        heading.focus({ preventScroll: true });
      });
    }
  }

  window.AccountView = Object.freeze({
    render: render,
    updateStatus: updateStatus,
    focusHeading: focusHeading,
    renderSettingsCard: renderSettingsCard
  });
})();
