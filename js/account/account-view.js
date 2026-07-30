/**
 * Schermata Account e sincronizzazione.
 *
 * La schermata descrive soltanto la preparazione locale. Non mostra moduli di
 * accesso e non promette una sincronizzazione cloud finché Supabase non sarà
 * realmente collegato.
 */
(function () {
  'use strict';

  var cloudIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H6a4 4 0 0 1-.45-7.97A6.5 6.5 0 0 1 18.1 9.2 4.9 4.9 0 0 1 17.5 19Z"/></svg>';
  var deviceIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 18h6"/></svg>';
  var accountIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  var queueIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r=".5" fill="currentColor"/><circle cx="3.5" cy="12" r=".5" fill="currentColor"/><circle cx="3.5" cy="18" r=".5" fill="currentColor"/></svg>';

  function plural(value, singular, pluralForm) {
    return value + ' ' + (value === 1 ? singular : pluralForm);
  }

  function formatDate(value) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) return 'Non ancora preparato';
    return new Date(Number(value)).toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function renderSettingsCard(status) {
    var ready = status && status.preparationEnabled;
    var badgeClass = ready ? 'sync-status-pill--ready' : 'sync-status-pill--local';
    var badgeText = ready ? 'Dispositivo pronto' : 'Non attiva';
    var title = ready
      ? 'Le modifiche vengono preparate in locale'
      : 'Le ricette restano solo su questo dispositivo';
    var description = ready
      ? plural(status.pendingRecipeCount, 'ricetta', 'ricette') + ' e ' +
        plural(status.pendingCount, 'modifica', 'modifiche') + ' nella coda locale. Nessun dato è online.'
      : 'Prepara una coda locale sicura prima di collegare, in futuro, il tuo account Supabase.';
    var buttonClass = ready ? 'btn btn--secondary' : 'btn btn--primary';
    var buttonText = ready ? 'Vedi preparazione' : 'Attiva sincronizzazione';

    return '' +
      '<section class="settings-card settings-card--sync" aria-labelledby="settings-sync-title">' +
        '<div class="settings-card__header">' +
          '<span class="settings-card__icon settings-card__icon--sync">' + cloudIcon + '</span>' +
          '<h2 class="settings-card__title" id="settings-sync-title">Account e sincronizzazione</h2>' +
        '</div>' +
        '<div class="settings-card__body">' +
          '<div class="sync-settings-summary">' +
            '<div class="sync-settings-summary__copy">' +
              '<span class="sync-status-pill ' + badgeClass + '">' + badgeText + '</span>' +
              '<h3>' + title + '</h3>' +
              '<p>' + description + '</p>' +
            '</div>' +
            '<button type="button" class="' + buttonClass + ' sync-settings-summary__action" data-action="go-account">' +
              buttonText +
            '</button>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  function preparationSteps(ready) {
    return '' +
      '<ol class="account-steps">' +
        '<li class="account-step' + (ready ? ' account-step--done' : ' account-step--current') + '">' +
          '<span class="account-step__marker">' + (ready ? Icons.check : '1') + '</span>' +
          '<div><strong>Preparazione locale</strong><span>' +
            (ready ? 'Completata su questo dispositivo' : 'Crea una coda delle ricette senza inviarle') +
          '</span></div>' +
        '</li>' +
        '<li class="account-step">' +
          '<span class="account-step__marker">2</span>' +
          '<div><strong>Collegamento account</strong><span>Arriverà con l’integrazione Supabase</span></div>' +
        '</li>' +
        '<li class="account-step">' +
          '<span class="account-step__marker">3</span>' +
          '<div><strong>Più dispositivi</strong><span>Invio e recupero incrementale delle modifiche</span></div>' +
        '</li>' +
      '</ol>';
  }

  async function render(container) {
    var status = await SyncPreparation.getStatus();
    var ready = status.preparationEnabled;
    var heroTitle = ready
      ? 'Questo dispositivo è pronto'
      : 'Prepara Sapori alla sincronizzazione';
    var heroText = ready
      ? 'La coda locale è attiva. Le tue ricette continuano a funzionare offline e nessun dato è stato caricato online.'
      : 'Creiamo una coda locale delle ricette e delle future modifiche. Non serve un account e nulla lascia il dispositivo.';
    var heroAction = ready
      ? '<div class="account-ready-message" role="status">' +
          '<span class="account-ready-message__icon">' + Icons.check + '</span>' +
          '<span>Preparazione completata il ' + formatDate(status.preparedAt) + '</span>' +
        '</div>'
      : '<button type="button" class="btn btn--primary account-prepare-button" data-action="prepare-sync">' +
          'Prepara questo dispositivo' +
        '</button>';
    var pendingDescription = ready
      ? plural(status.pendingCount, 'operazione leggera pronta', 'operazioni leggere pronte')
      : 'La coda verrà creata dopo la preparazione';

    var html = '<div class="view account-view animate-fade-in">';
    html +=
      '<header class="view-header view-header--back account-header">' +
        '<button type="button" class="btn btn--icon view-back-button" data-action="go-settings" aria-label="Torna alle impostazioni">' +
          Icons.arrowLeft +
        '</button>' +
        '<div class="account-header__copy">' +
          '<h1 class="view-header__title" id="account-title" tabindex="-1">Account e sincronizzazione</h1>' +
          '<p class="view-header__subtitle">Preparazione locale per il futuro collegamento Cloudflare Pages + Supabase</p>' +
        '</div>' +
      '</header>';

    html +=
      '<section class="account-hero account-hero--' + (ready ? 'ready' : 'local') + '" aria-labelledby="account-hero-title">' +
        '<div class="account-hero__icon">' + cloudIcon + '</div>' +
        '<span class="sync-status-pill ' + (ready ? 'sync-status-pill--ready' : 'sync-status-pill--local') + '">' +
          (ready ? 'Preparazione locale attiva' : 'Solo su questo dispositivo') +
        '</span>' +
        '<h2 id="account-hero-title">' + heroTitle + '</h2>' +
        '<p>' + heroText + '</p>' +
        '<div class="account-hero__action" id="sync-action-status" aria-live="polite">' + heroAction + '</div>' +
      '</section>';

    html += '<div class="account-card-grid">';
    html +=
      '<section class="account-card" aria-labelledby="device-card-title">' +
        '<div class="account-card__heading">' +
          '<span class="account-card__icon">' + deviceIcon + '</span>' +
          '<div><h2 id="device-card-title">Questo dispositivo</h2><p>Dati locali disponibili anche offline</p></div>' +
        '</div>' +
        '<div class="account-metrics">' +
          '<div class="account-metric"><strong>' + status.recipeCount + '</strong><span>' +
            (status.recipeCount === 1 ? 'Ricetta salvata' : 'Ricette salvate') +
          '</span></div>' +
          '<div class="account-metric"><strong>' + (ready ? status.pendingRecipeCount : '—') + '</strong><span>Ricette nella coda</span></div>' +
        '</div>' +
        '<div class="account-card__note">' + queueIcon + '<span>' + pendingDescription + '</span></div>' +
      '</section>';
    html +=
      '<section class="account-card" aria-labelledby="cloud-card-title">' +
        '<div class="account-card__heading">' +
          '<span class="account-card__icon">' + accountIcon + '</span>' +
          '<div><h2 id="cloud-card-title">Account cloud</h2><p>Nessun account collegato</p></div>' +
        '</div>' +
        '<div class="account-cloud-state">' +
          '<span class="sync-status-pill sync-status-pill--future">Passaggio futuro</span>' +
          '<p>Il login e il database Supabase non sono ancora configurati. Li aggiungeremo senza toccare le ricette già salvate.</p>' +
        '</div>' +
      '</section>';
    html += '</div>';

    html +=
      '<section class="account-card account-card--steps" aria-labelledby="steps-title">' +
        '<div class="account-card__heading">' +
          '<span class="account-card__icon">' + queueIcon + '</span>' +
          '<div><h2 id="steps-title">Percorso verso più dispositivi</h2><p>Tre passaggi separati e controllabili</p></div>' +
        '</div>' +
        preparationSteps(ready) +
      '</section>';

    html +=
      '<aside class="account-privacy-note" aria-label="Privacy della preparazione locale">' +
        '<span class="account-privacy-note__icon">' + Icons.shield + '</span>' +
        '<div><strong>Nessun dato viene inviato</strong>' +
          '<p>Questa preparazione non esegue richieste esterne. Ricette e foto restano nel browser finché non collegherai volontariamente un account.</p>' +
        '</div>' +
      '</aside>';
    html += '</div>';

    container.innerHTML = html;
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

  window.AccountView = {
    render: render,
    focusHeading: focusHeading,
    renderSettingsCard: renderSettingsCard
  };
})();
