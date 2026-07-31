/**
 * Sapori — Main Application Controller
 * Handles routing, event delegation, and all user interactions.
 */
(async function () {
  'use strict';

  /* ──────────────────── APP STATE ──────────────────── */

  var state = {
    currentView: 'home',
    filters: { search: '', category: '', sortBy: 'recent' },
    editingRecipe: null,
    savingRecipe: false,
    savingCategory: false,
    exportingPDF: false,
    draftSession: null,
    draftBaseRecipe: null,
    draftClosingPromise: null,
    imageProcessingPromise: null,
    routeToken: 0,
    lastStableHash: '#home',
    detailReturnHash: '#home',
    navigationConfirmed: false,
    pantryIngredients: [],
    cooking: {
      recipe: null,
      stepIndex: 0,
      checkedIngredients: {},
      wakeLockSentinel: null,
      ingExpanded: true,
      timer: { minutes: 0, seconds: 0, running: false, intervalId: null, endAt: null }
    }
  };

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' ||
        !state.cooking.recipe ||
        (state.cooking.wakeLockSentinel && !state.cooking.wakeLockSentinel.released)) {
      return;
    }

    try {
      var sentinel = await navigator.wakeLock.request('screen');
      state.cooking.wakeLockSentinel = sentinel;
      sentinel.addEventListener('release', function () {
        if (state.cooking.wakeLockSentinel === sentinel) {
          state.cooking.wakeLockSentinel = null;
          if (document.visibilityState === 'visible' && !modalOverlay.classList.contains('hidden')) {
            rerenderCookingModal();
          }
        }
      });
      console.log('Screen Wake Lock attivato.');
    } catch (err) {
      console.warn('Wake Lock error:', err);
      state.cooking.wakeLockSentinel = null;
    }
  }

  async function releaseWakeLock() {
    if (state.cooking && state.cooking.wakeLockSentinel) {
      var sentinel = state.cooking.wakeLockSentinel;
      state.cooking.wakeLockSentinel = null;
      try {
        if (!sentinel.released) await sentinel.release();
      } catch (err) {
        console.warn('Wake Lock release error:', err);
      }
    }
  }

  /* ── Timer helpers ── */

  var timerAudioContext = null;
  var COOKING_SESSION_KEY = 'sapori-cooking-session';
  var COOKING_SESSION_MAX_AGE = 8 * 24 * 60 * 60 * 1000;

  function persistCookingSession() {
    if (!state.cooking || !state.cooking.recipe || !state.cooking.recipe.id) return;
    var timer = state.cooking.timer;
    safeStorageSet(COOKING_SESSION_KEY, JSON.stringify({
      recipeId: state.cooking.recipe.id,
      stepIndex: state.cooking.stepIndex,
      checkedIngredients: state.cooking.checkedIngredients,
      ingExpanded: state.cooking.ingExpanded,
      timer: {
        minutes: timer.minutes,
        seconds: timer.seconds,
        running: timer.running,
        endAt: timer.endAt
      },
      savedAt: Date.now()
    }));
  }

  async function restoreCookingSession() {
    var stored = safeStorageGet(COOKING_SESSION_KEY);
    if (!stored) return;

    try {
      var saved = JSON.parse(stored);
      if (
        !saved ||
        typeof saved.recipeId !== 'string' ||
        !Number.isFinite(saved.savedAt) ||
        Date.now() - saved.savedAt > COOKING_SESSION_MAX_AGE
      ) {
        safeStorageRemove(COOKING_SESSION_KEY);
        return;
      }

      var recipe = await DB.getRecipe(saved.recipeId);
      if (!recipe) {
        safeStorageRemove(COOKING_SESSION_KEY);
        return;
      }

      var totalSteps = Array.isArray(recipe.steps) ? recipe.steps.length : 0;
      var stepIndex = Math.min(totalSteps, Math.max(0, parseInt(saved.stepIndex, 10) || 0));
      var checkedIngredients = {};
      var ingredientCount = Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0;
      if (saved.checkedIngredients && typeof saved.checkedIngredients === 'object') {
        Object.keys(saved.checkedIngredients).forEach(function (key) {
          var index = parseInt(key, 10);
          if (
            Number.isInteger(index) &&
            index >= 0 &&
            index < ingredientCount &&
            saved.checkedIngredients[key] === true
          ) {
            checkedIngredients[index] = true;
          }
        });
      }

      var savedTimer = saved.timer && typeof saved.timer === 'object' ? saved.timer : {};
      var minutes = Math.min(
        Recipes.LIMITS.minutes,
        Math.max(0, parseInt(savedTimer.minutes, 10) || 0)
      );
      var seconds = Math.min(59, Math.max(0, parseInt(savedTimer.seconds, 10) || 0));
      var endAt = Number(savedTimer.endAt);
      var running = savedTimer.running === true && Number.isFinite(endAt) && endAt > Date.now();
      var timerExpired = savedTimer.running === true && !running;

      if (running) {
        var remainingSeconds = Math.max(1, Math.ceil((endAt - Date.now()) / 1000));
        minutes = Math.floor(remainingSeconds / 60);
        seconds = remainingSeconds % 60;
      } else if (timerExpired) {
        minutes = 0;
        seconds = 0;
        endAt = null;
      }

      var restoredState = {
        recipe: recipe,
        stepIndex: stepIndex,
        checkedIngredients: checkedIngredients,
        wakeLockSentinel: null,
        ingExpanded: saved.ingExpanded !== false,
        timer: {
          minutes: minutes,
          seconds: seconds,
          running: running,
          intervalId: null,
          endAt: running ? endAt : null
        }
      };

      var reopen = function () {
        if (state.cooking.recipe) return;
        state.cooking = restoredState;
        if (state.cooking.timer.running) {
          state.cooking.timer.intervalId = setInterval(syncTimerFromDeadline, 250);
        }
        requestWakeLock().then(function () {
          rerenderCookingModal();
          if (timerExpired) {
            Utils.showToast('⏱ Il timer è terminato mentre l’app era chiusa.', 'success');
          }
        });
      };

      if (modalOverlay.classList.contains('hidden')) {
        reopen();
      } else {
        var observer = new MutationObserver(function () {
          if (modalOverlay.classList.contains('hidden')) {
            observer.disconnect();
            reopen();
          }
        });
        observer.observe(modalOverlay, { attributes: true, attributeFilter: ['class'] });
      }
    } catch (error) {
      safeStorageRemove(COOKING_SESSION_KEY);
    }
  }

  function prepareTimerAudio() {
    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
      if (!timerAudioContext || timerAudioContext.state === 'closed') {
        timerAudioContext = new AudioContextCtor();
      }
      if (timerAudioContext.state === 'suspended') {
        timerAudioContext.resume().catch(function () {});
      }
    } catch (err) {
      console.warn('Timer audio unavailable:', err);
    }
  }

  function playTimerSound() {
    if (!timerAudioContext || timerAudioContext.state !== 'running') return;
    try {
      var osc = timerAudioContext.createOscillator();
      var gain = timerAudioContext.createGain();
      osc.connect(gain);
      gain.connect(timerAudioContext.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, timerAudioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, timerAudioContext.currentTime + 0.6);
      osc.start();
      osc.stop(timerAudioContext.currentTime + 0.6);
    } catch (err) {
      console.warn('Timer sound error:', err);
    }
  }

  function updateTimerDisplay() {
    var display = document.getElementById('cooking-timer-display');
    if (!display) return false;

    var m = state.cooking.timer.minutes;
    var s = state.cooking.timer.seconds;
    display.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    display.className = 'cooking-modal__timer-display';
    if (state.cooking.timer.running) {
      if (m === 0 && s <= 10) display.classList.add('cooking-modal__timer-display--danger');
      else if (m === 0 && s <= 30) display.classList.add('cooking-modal__timer-display--warning');
      else display.classList.add('cooking-modal__timer-display--running');
    }
    return true;
  }

  function syncTimerFromDeadline() {
    var timer = state.cooking.timer;
    if (!timer.running || !timer.endAt) return;

    var remainingSeconds = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    timer.minutes = Math.floor(remainingSeconds / 60);
    timer.seconds = remainingSeconds % 60;

    if (remainingSeconds === 0) {
      finishTimer();
      return;
    }

    if (!updateTimerDisplay()) stopTimer();
  }

  function stopTimer() {
    var timer = state.cooking.timer;
    if (timer.running && timer.endAt) {
      var remainingSeconds = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
      timer.minutes = Math.floor(remainingSeconds / 60);
      timer.seconds = remainingSeconds % 60;
    }
    if (timer.intervalId !== null) clearInterval(timer.intervalId);
    timer.intervalId = null;
    timer.endAt = null;
    timer.running = false;
  }

  function finishTimer() {
    var timer = state.cooking.timer;
    if (timer.intervalId !== null) clearInterval(timer.intervalId);
    timer.intervalId = null;
    timer.endAt = null;
    timer.running = false;
    timer.minutes = 0;
    timer.seconds = 0;
    playTimerSound();
    if ('vibrate' in navigator) navigator.vibrate([180, 80, 180]);
    rerenderCookingModal();
    Utils.showToast('⏱ Timer terminato!', 'success');
  }

  function startTimer() {
    var timer = state.cooking.timer;
    if (timer.running) return;

    var minEl = document.getElementById('cooking-timer-min');
    var secEl = document.getElementById('cooking-timer-sec');
    if (minEl && secEl) {
      timer.minutes = Math.min(
        Recipes.LIMITS.minutes,
        Math.max(0, parseInt(minEl.value, 10) || 0)
      );
      timer.seconds = Math.min(59, Math.max(0, parseInt(secEl.value, 10) || 0));
    }
    var totalSeconds = timer.minutes * 60 + timer.seconds;
    if (totalSeconds === 0) {
      Utils.showToast('Imposta una durata maggiore di zero.', 'warning');
      return;
    }

    prepareTimerAudio();
    timer.endAt = Date.now() + totalSeconds * 1000;
    timer.running = true;
    if (timer.intervalId !== null) clearInterval(timer.intervalId);
    timer.intervalId = setInterval(syncTimerFromDeadline, 250);
    rerenderCookingModal();
    updateTimerDisplay();
  }

  function resetTimer() {
    stopTimer();
    state.cooking.timer.minutes = 0;
    state.cooking.timer.seconds = 0;
    state.cooking.timer.endAt = null;
    rerenderCookingModal();
  }

  function closeCookingSession() {
    stopTimer();
    releaseWakeLock();
    state.cooking.recipe = null;
    safeStorageRemove(COOKING_SESSION_KEY);
    Views.hideModal();
  }

  function describeCookingFocus(element) {
    if (!element || !modalOverlay.contains(element)) return null;
    var action = element.getAttribute ? element.getAttribute('data-action') : null;
    return {
      id: element.id || null,
      action: action,
      index: action === 'toggle-cooking-ing' ? element.getAttribute('data-index') : null,
      step: action === 'cooking-goto' ? element.getAttribute('data-step') : null
    };
  }

  function restoreCookingFocus(descriptor) {
    if (!descriptor) return;
    var replacement = descriptor.id ? document.getElementById(descriptor.id) : null;

    if (!replacement && descriptor.action) {
      var candidates = modalOverlay.querySelectorAll('[data-action]');
      replacement = Array.from(candidates).find(function (candidate) {
        if (candidate.getAttribute('data-action') !== descriptor.action) return false;
        if (descriptor.index !== null && candidate.getAttribute('data-index') !== descriptor.index) return false;
        if (descriptor.step !== null && candidate.getAttribute('data-step') !== descriptor.step) return false;
        return true;
      }) || null;
    }

    if (replacement && typeof replacement.focus === 'function') {
      replacement.focus();
    }
  }

  function rerenderCookingModal() {
    if (state.cooking && state.cooking.recipe) {
      persistCookingSession();
      var focusDescriptor = describeCookingFocus(document.activeElement);
      Views.showCookingModal(
        state.cooking.recipe,
        state.cooking.stepIndex,
        state.cooking.checkedIngredients,
        !!(state.cooking.wakeLockSentinel && !state.cooking.wakeLockSentinel.released),
        state.cooking.timer,
        state.cooking.ingExpanded
      );
      restoreCookingFocus(focusDescriptor);
    }
  }

  function updateServingsScale(delta) {
    var valEl = document.getElementById('detail-servings-val');
    if (!valEl) return;
    var baseServings = parseInt(valEl.getAttribute('data-base-servings'), 10) || 4;
    var currentVal = parseInt(valEl.textContent, 10) || baseServings;
    var newVal = Math.min(Recipes.LIMITS.servings, Math.max(1, currentVal + delta));
    valEl.textContent = newVal;

    var ratio = newVal / baseServings;

    var qtyEls = document.querySelectorAll('.ingredient-list .ing-qty');
    qtyEls.forEach(function (el) {
      var baseQty = el.getAttribute('data-base-qty');
      var unit = el.getAttribute('data-unit') || '';
      if (baseQty) {
        var scaledNum = Utils.scaleQuantity(baseQty, ratio);
        el.textContent = scaledNum + (unit ? ' ' + unit : '');
      }
    });
  }

  /* ──────────────────── DOM REFERENCES ──────────────────── */

  var appContent = document.getElementById('app-content');
  var bottomNav = document.getElementById('bottom-nav');
  var searchBar = document.getElementById('search-bar');
  var searchInput = document.getElementById('search-input');
  var btnSearchToggle = document.getElementById('btn-search-toggle');
  var btnSearchClose = document.getElementById('btn-search-close');
  var btnThemeToggle = document.getElementById('btn-theme-toggle');
  var modalOverlay = document.getElementById('modal-overlay');
  var routeAnnouncer = null;

  document.querySelectorAll('svg').forEach(function (icon) {
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
  });

  function ensureRouteAnnouncer() {
    if (routeAnnouncer && routeAnnouncer.isConnected) return routeAnnouncer;
    routeAnnouncer = document.getElementById('route-announcer');
    if (!routeAnnouncer) {
      routeAnnouncer = document.createElement('div');
      routeAnnouncer.id = 'route-announcer';
      routeAnnouncer.className = 'sr-only';
      routeAnnouncer.setAttribute('role', 'status');
      routeAnnouncer.setAttribute('aria-live', 'polite');
      routeAnnouncer.setAttribute('aria-atomic', 'true');
      document.body.appendChild(routeAnnouncer);
    }
    return routeAnnouncer;
  }

  function isBlockingDialogOpen() {
    var warningModal = document.getElementById('warning-modal');
    var warningOpen = warningModal && !warningModal.classList.contains('hidden');
    var appModalOpen = modalOverlay &&
      !modalOverlay.classList.contains('hidden') &&
      !!modalOverlay.firstElementChild;
    return !!(warningOpen || appModalOpen);
  }

  function finalizeRouteAccessibility(token, fallbackLabel) {
    if (token !== state.routeToken) return;

    appContent.setAttribute('aria-busy', 'false');
    var heading = appContent.querySelector('h1');
    var label = heading && heading.textContent
      ? heading.textContent.trim()
      : (fallbackLabel || 'Sapori');

    if (heading) {
      if (!heading.id) {
        heading.id = 'view-title-' + String(state.currentView || 'page').replace(/[^a-z0-9_-]/gi, '-');
      }
      heading.setAttribute('tabindex', '-1');
      appContent.setAttribute('aria-labelledby', heading.id);
    } else {
      appContent.removeAttribute('aria-labelledby');
    }

    document.title = label === 'Sapori'
      ? 'Sapori — Il Tuo Ricettario Personale'
      : label + ' — Sapori';

    var announcer = ensureRouteAnnouncer();
    announcer.textContent = '';
    window.requestAnimationFrame(function () {
      if (token !== state.routeToken || isBlockingDialogOpen()) return;
      announcer.textContent = 'Pagina ' + label + ' caricata';
      if (heading && heading.isConnected) {
        heading.focus({ preventScroll: true });
      }
    });
  }

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function safeStorageRemove(key) {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  function setupModalAccessibility() {
    var previousFocus = null;
    var modalActive = false;
    var backgroundNodes = [appContent, document.getElementById('app-header'), bottomNav, searchBar].filter(Boolean);

    function setBackgroundInert(active) {
      backgroundNodes.forEach(function (node) {
        node.inert = active;
      });
    }

    function focusableElements() {
      return Array.from(modalOverlay.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )).filter(function (element) {
        return element.getClientRects().length > 0;
      });
    }

    function ensureDialogSemantics() {
      var dialog = modalOverlay.firstElementChild;
      if (!dialog) return;
      if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
        var heading = dialog.querySelector('h1,h2,h3');
        if (heading) {
          if (!heading.id) heading.id = 'active-modal-title';
          dialog.setAttribute('aria-labelledby', heading.id);
        }
      }
    }

    function syncModalState() {
      var isOpen = !modalOverlay.classList.contains('hidden') && !!modalOverlay.firstElementChild;
      if (isOpen) {
        ensureDialogSemantics();
        modalOverlay.setAttribute('aria-hidden', 'false');
        if (!modalActive) {
          modalActive = true;
          previousFocus = document.activeElement;
          setBackgroundInert(true);
          var first = focusableElements()[0];
          if (first) first.focus();
        } else if (!modalOverlay.contains(document.activeElement)) {
          var fallback = focusableElements()[0];
          if (fallback) fallback.focus();
        }
      } else if (modalActive) {
        modalActive = false;
        modalOverlay.setAttribute('aria-hidden', 'true');
        setBackgroundInert(false);
        if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
          previousFocus.focus();
        }
        previousFocus = null;
      }
    }

    new MutationObserver(syncModalState).observe(modalOverlay, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: false
    });

    document.addEventListener('keydown', function (event) {
      if (!modalActive) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (document.getElementById('cooking-modal-inner')) closeCookingSession();
        else Views.hideModal();
        return;
      }
      if (event.key !== 'Tab') return;
      var focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    syncModalState();
  }

  /* ──────────────────── INITIALIZATION ──────────────────── */

  async function init() {
    await DB.init();
    await loadCustomCategories();
    await Theme.init();
    setupRouter();
    setupEventListeners();
    setupModalAccessibility();
    setupDataWarning();
    navigateTo(window.location.hash || '#home');
    restoreCookingSession();
    DraftStore.cleanup().catch(function (error) {
      console.warn('Pulizia periodica delle bozze non riuscita:', error);
    });
    registerServiceWorker();
  }

  async function loadCustomCategories() {
    try {
      var categoriesSetting = await DB.getSetting('customCategories');
      if (categoriesSetting) {
        var custom = DB._parseCustomCategories(categoriesSetting);
        // Rimuovi eventuali custom categories caricate in precedenza (evita duplicati)
        Recipes.CATEGORIES = Recipes.CATEGORIES.filter(function (cat) {
          return !cat.isCustom;
        });
        // Unisci soltanto categorie normalizzate e con ID non riservati.
        custom.forEach(function (cat) {
          Recipes.CATEGORIES.push(cat);
        });
        await DB.setSetting('customCategories', JSON.stringify(custom));
      }
    } catch (e) {
      console.warn('Errore nel caricamento delle categorie personalizzate:', e);
    }
  }

  async function saveCustomCategory(newCat) {
    if (state.savingCategory) return;
    state.savingCategory = true;
    try {
      var savedCategory = await DB.addCustomCategory(newCat);

      // Aggiorna array in esecuzione
      Recipes.CATEGORIES.push(savedCategory);
      
      Utils.showToast('Categoria aggiunta! 🏷️', 'success');
      
      // Re-render delle impostazioni
      if (state.currentView === 'settings') {
        renderActiveView('settings', function (container) {
          return Views.renderSettings(container);
        });
      }
    } catch (e) {
      Utils.showToast(e && e.message ? e.message : 'Errore durante il salvataggio della categoria', 'error');
    } finally {
      state.savingCategory = false;
    }
  }

  async function deleteCustomCategory(catId) {
    try {
      var result = await DB.deleteCustomCategory(catId, 'altro');
      var movedRecipes = result.movedRecipes;

      // Aggiorna l'array in esecuzione soltanto dopo il completamento
      // della transazione che modifica ricette e impostazioni insieme.
      Recipes.CATEGORIES = Recipes.CATEGORIES.filter(function (cat) {
        return cat.id !== catId;
      });

      Utils.showToast(
        movedRecipes > 0
          ? 'Categoria eliminata: ' + movedRecipes + ' ricett' + (movedRecipes === 1 ? 'a spostata' : 'e spostate') + ' in Altro.'
          : 'Categoria eliminata',
        'success'
      );

      if (state.currentView === 'settings') {
        renderActiveView('settings', function (container) {
          return Views.renderSettings(container);
        });
      }
    } catch (e) {
      Utils.showToast('Errore durante l\'eliminazione della categoria', 'error');
    }
  }

  function isSafeDraftId(value) {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(value);
  }

  function updateDraftStatus(status, details) {
    var element = document.getElementById('draft-save-status');
    if (!element) return;
    details = details || {};
    var error = details.error || null;
    var messages = {
      empty: 'Le modifiche vengono salvate automaticamente su questo dispositivo.',
      pending: 'Modifiche rilevate: salvataggio automatico in attesa…',
      saving: 'Salvataggio della bozza in corso…',
      recovered: 'Bozza recuperata. Le prossime modifiche saranno salvate automaticamente.',
      discarded: 'Bozza rimossa.',
      conflict: 'Questa bozza è stata aggiornata in un’altra scheda. Scegli quale versione continuare.',
      error: error && error.code === 'QUOTA_EXCEEDED'
        ? 'Spazio locale insufficiente: rimuovi una foto o libera spazio prima di continuare.'
        : 'Non riesco a salvare la bozza su questo dispositivo.'
    };
    if (status === 'saved' && Number.isFinite(Number(details.updatedAt))) {
      messages.saved = 'Bozza salvata alle ' + new Date(details.updatedAt).toLocaleTimeString(
        'it-IT',
        { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      ) + '.';
    } else if (status === 'saved') {
      messages.saved = 'Bozza salvata.';
    }
    var message = messages[status] || messages.empty;
    if (element.dataset.status !== status || element.textContent !== message) {
      element.dataset.status = status;
      element.textContent = message;
    }
    element.setAttribute(
      'role',
      status === 'error' || status === 'conflict' ? 'alert' : 'status'
    );
    element.setAttribute(
      'aria-live',
      status === 'error' || status === 'conflict' ? 'assertive' : 'polite'
    );

    var conflictActions = document.getElementById('draft-conflict-actions');
    if (status === 'conflict') {
      if (!conflictActions) {
        conflictActions = document.createElement('div');
        conflictActions.id = 'draft-conflict-actions';
        conflictActions.className = 'draft-conflict-actions';
        conflictActions.innerHTML =
          '<button type="button" class="btn btn--secondary btn--small" ' +
            'data-action="duplicate-conflicted-draft">Continua in una copia</button>' +
          '<button type="button" class="btn btn--ghost btn--small" ' +
            'data-action="reload-conflicted-draft">Carica l’altra scheda</button>';
        element.insertAdjacentElement('afterend', conflictActions);
      }
    } else if (conflictActions) {
      conflictActions.remove();
    }
  }

  function collectDraftPayload() {
    var activeTab = document.querySelector('.form-tab.active');
    return {
      version: 1,
      recipe: collectFormData(),
      activeTab: activeTab ? activeTab.id : 'tab-info',
      baseContentVersion: state.draftBaseRecipe &&
        Number.isSafeInteger(Number(state.draftBaseRecipe.contentVersion))
        ? Number(state.draftBaseRecipe.contentVersion)
        : 0,
      baseUpdatedAt: state.draftBaseRecipe
        ? Number(state.draftBaseRecipe.updatedAt) || null
        : null
    };
  }

  async function prepareDraftForm(mode, baseRecipe, draftId) {
    var target = {
      mode: mode,
      recipeId: mode === 'edit' ? baseRecipe.id : null,
      draftId: draftId
    };
    var session = null;
    session = DraftManager.open({
      target: target,
      delay: 600,
      read: collectDraftPayload,
      isDirty: isFormDirty,
      onStatus: function (status, details) {
        if (state.draftSession === session) {
          updateDraftStatus(status, details);
        }
      }
    });
    var record = null;
    try {
      record = await session.restore();
    } catch (error) {
      console.warn('Impossibile leggere la bozza locale:', error);
      updateDraftStatus('error', { error: error });
    }

    var data = record && record.data &&
      record.data.recipe &&
      Object.prototype.toString.call(record.data.recipe) === '[object Object]'
      ? record.data
      : null;
    var recipe = data ? Object.assign({}, data.recipe) : baseRecipe;
    if (mode === 'edit') {
      recipe.id = baseRecipe.id;
      recipe.createdAt = baseRecipe.createdAt;
      recipe.isFavorite = baseRecipe.isFavorite;

      var currentContentVersion = Number.isSafeInteger(Number(baseRecipe.contentVersion))
        ? Number(baseRecipe.contentVersion)
        : 0;
      var draftContentVersion = Number.isSafeInteger(Number(recipe.contentVersion))
        ? Number(recipe.contentVersion)
        : null;
      if (draftContentVersion === null && data &&
          Number.isSafeInteger(Number(data.baseContentVersion))) {
        draftContentVersion = Number(data.baseContentVersion);
      }
      if (draftContentVersion === null) {
        draftContentVersion = data &&
          Number(data.baseUpdatedAt) !== Number(baseRecipe.updatedAt)
          ? 0
          : currentContentVersion;
      }
      recipe.contentVersion = draftContentVersion;
    }
    var activeTab = data && ['tab-info', 'tab-prep', 'tab-cook'].includes(data.activeTab)
      ? data.activeTab
      : 'tab-info';
    var draftConflict = Boolean(
      mode === 'edit' &&
      data &&
      Number(recipe.contentVersion) !== Number(baseRecipe.contentVersion)
    );

    return {
      session: session,
      record: record,
      recipe: recipe,
      activeTab: activeTab,
      draftConflict: draftConflict
    };
  }

  async function closeCurrentDraftSession(flush) {
    var session = state.draftSession;
    if (!session) {
      return state.draftClosingPromise
        ? await state.draftClosingPromise
        : null;
    }

    var formView = appContent.querySelector('.form-view');
    var formWasInert = formView ? formView.inert === true : false;
    if (formView) formView.inert = true;
    var closingPromise = session.close({ flush: flush !== false });
    state.draftClosingPromise = closingPromise;
    var outcome = null;
    try {
      outcome = await closingPromise;
      if (outcome && outcome.closed && state.draftSession === session) {
        state.draftSession = null;
        state.draftBaseRecipe = null;
      }
      return outcome;
    } finally {
      if ((!outcome || !outcome.closed) && formView && formView.isConnected) {
        formView.inert = formWasInert;
      }
      if (state.draftClosingPromise === closingPromise) {
        state.draftClosingPromise = null;
      }
    }
  }

  async function discardDraftSession(session) {
    if (!session) {
      if (state.draftClosingPromise) await state.draftClosingPromise;
      return false;
    }
    if (state.draftClosingPromise) await state.draftClosingPromise;

    var discardPromise = (async function () {
      var result = await session.discard();
      await session.close({ flush: false, forceClose: true });
      return result;
    })();
    state.draftClosingPromise = discardPromise;
    try {
      return await discardPromise;
    } finally {
      if (state.draftClosingPromise === discardPromise) {
        state.draftClosingPromise = null;
      }
    }
  }

  async function discardCurrentDraftSession() {
    var session = state.draftSession;
    invalidatePendingImageProcessing();
    var result = await discardDraftSession(session);
    if (state.draftSession === session) {
      state.draftSession = null;
      state.draftBaseRecipe = null;
    }
    return result;
  }

  async function discardDraftAndNavigate(hash) {
    var formView = appContent.querySelector('.form-view');
    var wasInert = formView ? formView.inert === true : false;
    if (formView) formView.inert = true;
    try {
      var result = await discardCurrentDraftSession();
      if (result && result.status === 'conflict') {
        Utils.showToast(
          'La bozza aggiornata nell’altra scheda è stata mantenuta.',
          'warning'
        );
      }
      navigateTo(hash, true);
    } catch (error) {
      if (formView && formView.isConnected) formView.inert = wasInert;
      console.error('Impossibile rimuovere la bozza locale:', error);
      Utils.showToast(
        'Non riesco a eliminare la bozza. Riprova prima di uscire.',
        'error'
      );
    }
  }

  async function abandonDraftAndNavigate(session, hash) {
    var formView = appContent.querySelector('.form-view');
    if (formView) formView.inert = true;
    try {
      invalidatePendingImageProcessing();
      await session.close({ flush: false, forceClose: true });
      if (state.draftSession === session) {
        state.draftSession = null;
        state.draftBaseRecipe = null;
      }
      navigateTo(hash, true);
    } catch (error) {
      if (formView && formView.isConnected) formView.inert = false;
      console.error('Impossibile chiudere la sessione della bozza:', error);
      Utils.showToast('Non riesco a chiudere il modulo in sicurezza.', 'error');
    }
  }

  function showDraftCloseFailure(session, requestedHash) {
    Views.showConfirmModal(
      'Ultima modifica non salvata',
      'Non riesco a salvare l’ultima modifica della bozza. Resta nel modulo e riprova; se esci ora, rimarrà soltanto l’ultima versione già salvata.',
      function () {
        Views.hideModal();
        abandonDraftAndNavigate(session, requestedHash);
      },
      {
        cancelLabel: 'Resta e riprova',
        confirmLabel: 'Esci senza ultima modifica',
        confirmClass: 'btn--danger'
      }
    );
  }

  function draftHash(target) {
    if (target.mode === 'edit') {
      return '#edit/' + encodeURIComponent(target.recipeId) + '/' +
        encodeURIComponent(target.draftId);
    }
    return '#create/' + encodeURIComponent(target.draftId);
  }

  async function renderDraftLibrary(container) {
    var items = await DraftCatalog.load();
    DraftCatalog.render(container, items);
  }

  function refreshDraftLibrary() {
    if (state.currentView !== 'drafts') return Promise.resolve(false);
    return renderActiveView('drafts', renderDraftLibrary).then(function (rendered) {
      if (rendered) {
        window.requestAnimationFrame(function () {
          var heading = appContent.querySelector('.draft-library-view h1');
          if (heading) heading.focus({ preventScroll: true });
        });
      }
      return rendered;
    });
  }

  function draftTargetFromSnapshot(snapshot) {
    return {
      mode: snapshot.mode,
      recipeId: snapshot.recipeId,
      draftId: snapshot.draftId
    };
  }

  function draftRecipeId(record) {
    var data = record && record.data;
    var recipe = data && Object.prototype.toString.call(data.recipe) === '[object Object]'
      ? data.recipe
      : null;
    return recipe && isSafeDraftId(recipe.id) ? recipe.id : null;
  }

  async function recoverOrphanedDraft(record, snapshot) {
    var sourceData = record && record.data &&
      Object.prototype.toString.call(record.data) === '[object Object]'
      ? record.data
      : {};
    var sourceRecipe = sourceData.recipe &&
      Object.prototype.toString.call(sourceData.recipe) === '[object Object]'
      ? sourceData.recipe
      : {};
    var recoveredData = Object.assign({}, sourceData, {
      recipe: Object.assign({}, sourceRecipe, {
        id: Utils.generateId(),
        contentVersion: 0,
        isFavorite: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }),
      baseContentVersion: 0,
      baseUpdatedAt: null
    });
    var recoveredTarget = {
      mode: 'create',
      recipeId: null,
      draftId: DraftManager.createId('recupero')
    };

    await DraftStore.save(recoveredTarget, recoveredData, {
      writerId: DraftManager.createId('recupero'),
      expectedRevision: null
    });
    var removed = await DraftStore.remove(draftTargetFromSnapshot(snapshot), {
      expectedRevision: record.revision
    });
    Utils.showToast(
      removed
        ? 'Bozza recuperata come nuova ricetta'
        : 'Copia recuperata; una versione più recente è rimasta nell’archivio',
      removed ? 'success' : 'warning'
    );
    navigateTo(DraftCatalog.routeFor(recoveredTarget), true);
  }

  async function resumeDraft(actionElement) {
    var snapshot = DraftCatalog.targetFromElement(actionElement);
    if (!snapshot) {
      Utils.showToast('Questa bozza non ha un identificatore valido', 'error');
      return;
    }
    actionElement.disabled = true;
    actionElement.setAttribute('aria-busy', 'true');
    try {
      var target = draftTargetFromSnapshot(snapshot);
      var record = await DraftStore.get(target);
      if (!record) {
        Utils.showToast('La bozza non esiste più', 'warning');
        await refreshDraftLibrary();
        return;
      }
      if (Number(record.revision) !== Number(snapshot.revision)) {
        Utils.showToast(
          'La bozza è cambiata in un’altra scheda: ho aggiornato l’elenco.',
          'warning'
        );
        await refreshDraftLibrary();
        return;
      }

      if (record.mode === 'create') {
        var savedRecipeId = draftRecipeId(record);
        var savedRecipe = savedRecipeId
          ? await DB.getRecipe(savedRecipeId)
          : null;
        if (savedRecipe) {
          var removedResidual = await DraftStore.remove(target, {
            expectedRevision: record.revision
          });
          Utils.showToast(
            removedResidual
              ? 'Bozza residua rimossa: la ricetta era già salvata'
              : 'La bozza è cambiata ed è stata mantenuta',
            removedResidual ? 'success' : 'warning'
          );
          navigateTo('#detail/' + encodeURIComponent(savedRecipeId), true);
          return;
        }
        navigateTo(DraftCatalog.routeFor(record), true);
        return;
      }

      var originalRecipe = await DB.getRecipe(record.recipeId);
      if (originalRecipe) {
        navigateTo(DraftCatalog.routeFor(record), true);
        return;
      }
      await recoverOrphanedDraft(record, snapshot);
    } catch (error) {
      console.error('Impossibile aprire la bozza:', error);
      Utils.showToast('Non riesco ad aprire questa bozza', 'error');
    } finally {
      if (actionElement.isConnected) {
        actionElement.disabled = false;
        actionElement.removeAttribute('aria-busy');
      }
    }
  }

  function confirmDeleteDraft(actionElement) {
    var snapshot = DraftCatalog.targetFromElement(actionElement);
    if (!snapshot) {
      Utils.showToast('Questa bozza non ha un identificatore valido', 'error');
      return;
    }
    var card = actionElement.closest('.draft-card');
    var heading = card && card.querySelector('h2');
    var draftName = heading ? heading.textContent.trim() : 'questa ricetta';
    Views.showConfirmModal(
      'Eliminare la bozza?',
      'Le modifiche locali di “' + draftName + '” saranno eliminate definitivamente.',
      async function () {
        Views.hideModal();
        try {
          var target = draftTargetFromSnapshot(snapshot);
          var removed = await DraftStore.remove(target, {
            expectedRevision: snapshot.revision
          });
          if (removed) {
            Utils.showToast('Bozza eliminata', 'success');
          } else {
            var current = await DraftStore.get(target);
            Utils.showToast(
              current
                ? 'La bozza è cambiata in un’altra scheda ed è stata mantenuta'
                : 'La bozza era già stata eliminata',
              current ? 'warning' : 'info'
            );
          }
          await refreshDraftLibrary();
        } catch (error) {
          console.error('Impossibile eliminare la bozza:', error);
          Utils.showToast('Non riesco a eliminare questa bozza', 'error');
        }
      },
      {
        cancelLabel: 'Mantieni bozza',
        confirmLabel: 'Elimina bozza',
        confirmClass: 'btn--danger'
      }
    );
  }

  async function duplicateConflictedDraft() {
    var session = state.draftSession;
    var formView = appContent.querySelector('.form-view');
    if (!session || !formView) return;
    formView.inert = true;

    try {
      var pendingImage = state.imageProcessingPromise;
      if (pendingImage) await pendingImage;
      if (
        state.draftSession !== session ||
        !formView.isConnected
      ) {
        return;
      }
      var target = {
        mode: session.target.mode,
        recipeId: session.target.recipeId,
        draftId: DraftManager.createId(
          session.target.mode === 'edit' ? 'edit' : 'create'
        )
      };
      await DraftStore.save(target, collectDraftPayload(), {
        writerId: DraftManager.createId('copia'),
        expectedRevision: null
      });
      invalidatePendingImageProcessing();
      await session.close({ flush: false, forceClose: true });
      if (state.draftSession === session) {
        state.draftSession = null;
        state.draftBaseRecipe = null;
      }
      Utils.showToast('Copia separata creata senza sovrascrivere l’altra scheda', 'success');
      navigateTo(draftHash(target), true);
    } catch (error) {
      if (formView.isConnected) formView.inert = false;
      console.error('Impossibile duplicare la bozza in conflitto:', error);
      Utils.showToast('Non riesco a creare una copia della bozza', 'error');
    }
  }

  function confirmReloadConflictedDraft() {
    var session = state.draftSession;
    if (!session) return;
    var currentHash = window.location.hash;
    Views.showConfirmModal(
      'Caricare la bozza dell’altra scheda?',
      'Le modifiche non ancora salvate in questa scheda saranno sostituite dalla versione più recente presente sul dispositivo.',
      function () {
        Views.hideModal();
        abandonDraftAndNavigate(session, currentHash);
      },
      {
        cancelLabel: 'Mantieni questa versione',
        confirmLabel: 'Carica versione recente',
        confirmClass: 'btn--primary'
      }
    );
  }

  function scheduleCurrentDraft() {
    if (state.draftSession) state.draftSession.schedule();
  }

  /* ──────────────────── HASH-BASED ROUTER ──────────────────── */

  function setupRouter() {
    window.addEventListener('hashchange', function () {
      var hash = window.location.hash || '#home';
      if (state.savingRecipe && !state.navigationConfirmed) {
        window.history.replaceState(null, '', state.lastStableHash || '#home');
        Utils.showToast('Salvataggio in corso: attendi ancora un momento.', 'warning');
        return;
      }
      if (!state.navigationConfirmed && hasUnsavedForm()) {
        var requestedHash = hash;
        window.history.replaceState(null, '', state.lastStableHash || '#home');
        confirmUnsavedNavigation(requestedHash);
        return;
      }
      state.navigationConfirmed = false;
      handleRoute(hash);
    });
  }

  function isDetailReturnHash(hash) {
    var route = String(hash || '').replace(/^#/, '').split('/')[0];
    return route === 'home' || route === 'favorites' || route === 'pantry';
  }

  async function renderRouteView(token, renderer) {
    var staging = document.createElement('div');
    await renderer(staging);
    if (token !== state.routeToken) return false;
    appContent.innerHTML = staging.innerHTML;
    return true;
  }

  function showViewLoadError() {
    appContent.innerHTML =
      '<div class="view empty-state" role="alert">' +
        '<h1>Impossibile caricare questa sezione</h1>' +
        '<p>I dati locali non sono disponibili in questo momento. Riprova senza chiudere l’app.</p>' +
        '<button type="button" class="btn btn--primary" data-action="retry-route">Riprova</button>' +
      '</div>';
  }

  async function renderActiveView(view, renderer) {
    if (state.currentView !== view) return false;
    var token = ++state.routeToken;
    try {
      return await renderRouteView(token, renderer);
    } catch (error) {
      if (token !== state.routeToken || state.currentView !== view) return false;
      console.error('Errore durante l’aggiornamento della vista:', error);
      showViewLoadError();
      return false;
    }
  }

  async function handleRoute(hash) {
    var token = ++state.routeToken;
    appContent.setAttribute('aria-busy', 'true');
    try {
      var pendingImage = state.imageProcessingPromise;
      if (pendingImage) await pendingImage;
      if (token !== state.routeToken) return;
      invalidatePendingImageProcessing();
      var sessionBeingClosed = state.draftSession;
      var closeOutcome = await closeCurrentDraftSession(true);
      if (token !== state.routeToken) return;
      if (closeOutcome && closeOutcome.closed === false) {
        window.history.replaceState(null, '', state.lastStableHash || '#home');
        state.navigationConfirmed = false;
        appContent.setAttribute('aria-busy', 'false');
        showDraftCloseFailure(sessionBeingClosed, hash);
        return;
      }

    // Parse the hash
    var parts = hash.replace('#', '').split('/');
    var view = parts[0] || 'home';
    var param = null;
    var secondaryParam = null;
    if (parts.length > 1) {
      try {
        param = decodeURIComponent(parts[1]);
      } catch (error) {
        param = parts[1];
      }
    }
    if (parts.length > 2) {
      try {
        secondaryParam = decodeURIComponent(parts[2]);
      } catch (secondaryError) {
        secondaryParam = parts[2];
      }
    }

    if (view === 'detail' && isDetailReturnHash(state.lastStableHash)) {
      state.detailReturnHash = state.lastStableHash;
    }

    state.currentView = view;
    closeSearch(false, false);

    // Transition animation
    appContent.classList.add('animate-fade-in');
    setTimeout(function () { appContent.classList.remove('animate-fade-in'); }, 400);

    switch (view) {
      case 'home':
        updateNav('home');
        showHeader(true, true);
        appContent.innerHTML = '<div class="view" role="status">Caricamento ricette…</div>';
        await renderRouteView(token, function (container) {
          return Views.renderHome(container, state.filters);
        });
        break;

      case 'create':
        updateNav('create');
        showHeader(false, false);
        state.editingRecipe = null;
        var createDraftId = isSafeDraftId(param)
          ? param
          : DraftManager.createId('create');
        if (createDraftId !== param) {
          hash = '#create/' + encodeURIComponent(createDraftId);
          window.history.replaceState(null, '', hash);
        }
        var emptyRecipe = Recipes.createEmptyRecipe();
        state.draftBaseRecipe = emptyRecipe;
        var createDraft = await prepareDraftForm('create', emptyRecipe, createDraftId);
        if (token !== state.routeToken) {
          await createDraft.session.close({ flush: false });
          return;
        }
        state.draftSession = createDraft.session;
        Views.renderCreate(appContent, createDraft.recipe, {
          mode: 'create',
          draftRecovered: Boolean(createDraft.record),
          draftUpdatedAt: createDraft.record && createDraft.record.updatedAt
        });
        if (createDraft.activeTab !== 'tab-info') {
          switchFormTab(createDraft.activeTab);
        }
        break;

      case 'edit':
        updateNav('create');
        showHeader(false, false);
        if (param) {
          appContent.innerHTML = '<div class="view" role="status">Caricamento ricetta…</div>';
          var recipe = await DB.getRecipe(param);
          if (token !== state.routeToken) return;
          if (recipe) {
            state.editingRecipe = recipe;
            var editDraftId = isSafeDraftId(secondaryParam)
              ? secondaryParam
              : DraftManager.createId('edit');
            if (editDraftId !== secondaryParam) {
              hash = '#edit/' + encodeURIComponent(param) + '/' +
                encodeURIComponent(editDraftId);
              window.history.replaceState(null, '', hash);
            }
            state.draftBaseRecipe = recipe;
            var editDraft = await prepareDraftForm('edit', recipe, editDraftId);
            if (token !== state.routeToken) {
              await editDraft.session.close({ flush: false });
              return;
            }
            state.draftSession = editDraft.session;
            Views.renderCreate(appContent, editDraft.recipe, {
              mode: 'edit',
              draftRecovered: Boolean(editDraft.record),
              draftUpdatedAt: editDraft.record && editDraft.record.updatedAt,
              draftConflict: editDraft.draftConflict
            });
            if (editDraft.activeTab !== 'tab-info') {
              switchFormTab(editDraft.activeTab);
            }
          } else {
            Utils.showToast('Ricetta non trovata', 'error');
            navigateTo('#home', true);
            return;
          }
        } else {
          navigateTo('#home', true);
          return;
        }
        break;

      case 'detail':
        updateNav('');
        showHeader(false, false);
        if (param) {
          appContent.innerHTML = '<div class="view" role="status">Caricamento ricetta…</div>';
          await renderRouteView(token, function (container) {
            return Views.renderDetail(container, param);
          });
        } else {
          navigateTo('#home', true);
          return;
        }
        break;

      case 'favorites':
        updateNav('favorites');
        showHeader(true, false);
        appContent.innerHTML = '<div class="view" role="status">Caricamento preferiti…</div>';
        await renderRouteView(token, function (container) {
          return Views.renderFavorites(container);
        });
        break;

      case 'drafts':
        updateNav('home');
        showHeader(true, false);
        appContent.innerHTML = '<div class="view" role="status">Caricamento bozze…</div>';
        await renderRouteView(token, renderDraftLibrary);
        break;

      case 'settings':
        updateNav('settings');
        showHeader(true, false);
        appContent.innerHTML = '<div class="view" role="status">Caricamento impostazioni…</div>';
        await renderRouteView(token, function (container) {
          return Views.renderSettings(container);
        });
        break;

      case 'account':
        updateNav('settings');
        showHeader(true, false);
        appContent.innerHTML = '<div class="view" role="status">Caricamento account…</div>';
        await renderRouteView(token, function (container) {
          return AccountView.render(container);
        });
        break;

      case 'pantry':
        updateNav('');
        showHeader(false, false);
        appContent.innerHTML = '<div class="view" role="status">Cerco le ricette compatibili…</div>';
        await renderRouteView(token, function (container) {
          return Views.renderPantry(container, state.pantryIngredients);
        });
        break;

      default:
        navigateTo('#home', true);
        return;
    }

    if (token !== state.routeToken) return;
    state.lastStableHash = hash;
    state.navigationConfirmed = false;

    // Scroll to top on view change
    window.scrollTo({ top: 0, behavior: 'smooth' });
    finalizeRouteAccessibility(token);
    } catch (error) {
      if (token !== state.routeToken) return;
      console.error('Errore durante il caricamento della rotta:', error);
      showViewLoadError();
      state.lastStableHash = hash;
      state.navigationConfirmed = false;
      finalizeRouteAccessibility(token, 'Errore');
    }
  }

  function hasUnsavedForm() {
    return (state.currentView === 'create' || state.currentView === 'edit') &&
      !!document.getElementById('recipe-form') &&
      (isFormDirty() || !!state.imageProcessingPromise);
  }

  function confirmUnsavedNavigation(hash) {
    Views.showConfirmModal(
      'Modifiche non salvate',
      'Le modifiche resteranno in una bozza locale su questo dispositivo. Vuoi uscire dal modulo?',
      function () {
        Views.hideModal();
        navigateTo(hash, true);
      }
    );
  }

  function navigateTo(hash, force) {
    if (state.savingRecipe) {
      Utils.showToast('Salvataggio in corso: attendi ancora un momento.', 'warning');
      return;
    }
    if (!force && hasUnsavedForm()) {
      confirmUnsavedNavigation(hash);
      return;
    }
    state.navigationConfirmed = !!force;
    if (window.location.hash === hash) {
      // Force re-render even if same hash
      handleRoute(hash);
    } else {
      window.location.hash = hash;
    }
  }

  function setSearchAvailability(available) {
    var isAvailable = available === true;
    btnSearchToggle.classList.toggle('hidden', !isAvailable);
    btnSearchToggle.disabled = !isAvailable;
    btnSearchToggle.setAttribute('aria-hidden', isAvailable ? 'false' : 'true');
    if (!isAvailable && !searchBar.classList.contains('hidden')) {
      closeSearch(false, false);
    }
  }

  function showHeader(visible, searchAvailable) {
    var header = document.getElementById('app-header');
    if (visible) {
      header.classList.remove('hidden');
      bottomNav.classList.remove('hidden');
      document.body.classList.remove('app-chrome-hidden');
      setSearchAvailability(searchAvailable);
    } else {
      header.classList.add('hidden');
      bottomNav.classList.add('hidden');
      document.body.classList.add('app-chrome-hidden');
      setSearchAvailability(false);
    }
  }

  /* ──────────────────── NAV UPDATE ──────────────────── */

  function updateNav(view) {
    var items = bottomNav.querySelectorAll('.nav-item');
    items.forEach(function (item) {
      if (item.getAttribute('data-view') === view) {
        item.classList.add('active');
        item.setAttribute('aria-current', 'page');
      } else {
        item.classList.remove('active');
        item.removeAttribute('aria-current');
      }
    });
  }

  /* ──────────────────── SEARCH ──────────────────── */

  function openSearch() {
    if (btnSearchToggle.disabled || btnSearchToggle.classList.contains('hidden')) return;
    searchBar.classList.remove('hidden');
    document.body.classList.add('search-open');
    btnSearchToggle.setAttribute('aria-expanded', 'true');
    searchInput.focus();
  }

  function closeSearch(shouldRender, restoreFocus) {
    if (shouldRender === undefined) shouldRender = true;
    if (restoreFocus === undefined) restoreFocus = true;
    if (debouncedSearch && typeof debouncedSearch.cancel === 'function') {
      debouncedSearch.cancel();
    }
    searchBar.classList.add('hidden');
    document.body.classList.remove('search-open');
    btnSearchToggle.setAttribute('aria-expanded', 'false');
    searchInput.value = '';
    if (state.filters.search !== '') {
      state.filters.search = '';
      if (shouldRender && state.currentView === 'home') {
        renderActiveView('home', function (container) {
          return Views.renderHome(container, state.filters);
        });
      }
    }
    if (restoreFocus && !btnSearchToggle.disabled && !btnSearchToggle.classList.contains('hidden')) {
      window.requestAnimationFrame(function () {
        btnSearchToggle.focus();
      });
    }
  }

  var debouncedSearch = Utils.debounce(function (value) {
    state.filters.search = value;
    if (state.currentView === 'home') {
      renderActiveView('home', function (container) {
        return Views.renderHome(container, state.filters);
      });
    }
  }, 300);

  /* ──────────────────── FAVORITE TOGGLE ──────────────────── */

  async function toggleFavorite(id) {
    try {
      var isFavorite = await DB.toggleFavorite(id);
      if (isFavorite === null) return null;
      Utils.showToast(
        isFavorite ? 'Aggiunta ai preferiti ❤️' : 'Rimossa dai preferiti',
        'success'
      );
      return isFavorite;
    } catch (e) {
      Utils.showToast('Errore nel salvataggio', 'error');
      return null;
    }
  }

  /* ──────────────────── FORM: COLLECT DATA ──────────────────── */

  function collectFormData() {
    function readInteger(id, fallback) {
      var raw = document.getElementById(id).value.trim();
      return raw === '' ? fallback : Number(raw);
    }

    var idInput = document.getElementById('input-id');
    var contentVersionInput = document.getElementById('input-content-version');
    var name = document.getElementById('input-name').value.trim();
    var category = document.getElementById('input-category').value;
    var description = (document.getElementById('input-description').value || '').trim();
    var notes = (document.getElementById('input-notes').value || '').trim();
    var storage = (document.getElementById('input-storage').value || '').trim();
    var imageData = document.getElementById('input-image-data').value || '';
    var imageThumbnailData = document.getElementById('input-image-thumbnail-data').value || '';
    var prepTime = readInteger('input-preptime', 0);
    var cookTime = readInteger('input-cooktime', 0);
    var difficulty = document.getElementById('input-difficulty').value;
    var servings = readInteger('input-servings', 4);

    // Collect ingredients
    var ingRows = document.querySelectorAll('#ingredients-list .ingredient-row');
    var ingredients = [];
    ingRows.forEach(function (row) {
      var ingName = row.querySelector('[data-field="ing-name"]').value.trim();
      var ingQty = row.querySelector('[data-field="ing-qty"]').value.trim();
      var ingUnit = row.querySelector('[data-field="ing-unit"]').value;
      var ingNotesEl = row.querySelector('[data-field="ing-notes"]');
      var ingNotes = ingNotesEl ? ingNotesEl.value.trim() : '';
      ingredients.push({ name: ingName, quantity: ingQty, unit: ingUnit, notes: ingNotes });
    });

    // Collect steps
    var stepRows = document.querySelectorAll('#steps-list .step-item');
    var steps = [];
    stepRows.forEach(function (row) {
      var text = row.querySelector('[data-field="step-text"]').value.trim();
      var stepNotesEl = row.querySelector('[data-field="step-notes"]');
      var notes = stepNotesEl ? stepNotesEl.value.trim() : '';
      steps.push({ text: text, notes: notes });
    });

    var now = Date.now();
    var recipe = {
      id: idInput ? idInput.value : Utils.generateId(),
      name: name,
      category: category,
      description: description,
      notes: notes,
      storage: storage,
      ingredients: ingredients,
      steps: steps,
      prepTime: prepTime,
      cookTime: cookTime,
      difficulty: difficulty,
      servings: servings,
      image: imageData || null,
      imageThumbnail: imageThumbnailData || null,
      isFavorite: state.editingRecipe ? state.editingRecipe.isFavorite : false,
      contentVersion: contentVersionInput &&
        Number.isSafeInteger(Number(contentVersionInput.value))
        ? Number(contentVersionInput.value)
        : 0,
      createdAt: state.editingRecipe ? state.editingRecipe.createdAt : now,
      updatedAt: now
    };

    return recipe;
  }

  /* ──────────────────── FORM: SHOW ERRORS ──────────────────── */

  function clearFormErrors() {
    var errors = document.querySelectorAll('.form-error');
    errors.forEach(function (el) { el.textContent = ''; });
    var groups = document.querySelectorAll('.form-group.has-error');
    groups.forEach(function (el) { el.classList.remove('has-error'); });
    document.querySelectorAll('[aria-invalid="true"]').forEach(function (el) {
      el.removeAttribute('aria-invalid');
    });
  }

  function switchFormTab(targetId, focusPanel) {
    var tabs = document.querySelectorAll('.form-tab');
    var navBtns = document.querySelectorAll('.form-steps-btn');
    var targetPanel = null;
    
    tabs.forEach(function (tab) {
      if (tab.id === targetId) {
        tab.classList.add('active');
        tab.setAttribute('aria-hidden', 'false');
        targetPanel = tab;
      } else {
        tab.classList.remove('active');
        tab.setAttribute('aria-hidden', 'true');
      }
    });

    navBtns.forEach(function (btn) {
      if (btn.getAttribute('data-target') === targetId) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        btn.setAttribute('tabindex', '0');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
        btn.setAttribute('tabindex', '-1');
      }
    });

    if (focusPanel && targetPanel) {
      window.requestAnimationFrame(function () {
        if (!targetPanel.isConnected || !targetPanel.classList.contains('active')) return;
        var firstControl = targetPanel.querySelector(
          'input:not([type="hidden"]):not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled])'
        );
        if (firstControl) firstControl.focus();
      });
    }
  }

  function isFormDirty() {
    var current = collectFormData();
    var original = state.editingRecipe;

    if (!original) {
      // In creazione: confronta contro i default reali del form vuoto
      // (category e difficulty partono già pre-valorizzate da
      // Recipes.createEmptyRecipe(), quindi "non vuoto" da solo non basta
      // a dire che l'utente ha davvero modificato qualcosa).
      var emptyDefaults = Recipes.createEmptyRecipe();
      if (current.name && current.name.trim() !== '') return true;
      if (current.category && current.category !== emptyDefaults.category) return true;
      if (current.difficulty && current.difficulty !== emptyDefaults.difficulty) return true;
      if (current.description && current.description.trim() !== '') return true;
      if (current.notes && current.notes.trim() !== '') return true;
      if (current.storage && current.storage.trim() !== '') return true;
      if (current.image) return true;
      if (current.prepTime) return true;
      if (current.cookTime) return true;
      if (current.servings && current.servings !== 4 && current.servings !== '') return true;
      
      // Controlla ingredienti
      var ingDirty = current.ingredients.some(function (ing) {
        return (ing.name && ing.name.trim() !== '') || ing.quantity || ing.unit || (ing.notes && ing.notes.trim() !== '');
      });
      if (ingDirty) return true;

      // Controlla passaggi
      var stepDirty = current.steps.some(function (step) {
        var stepText = typeof step === 'object' ? step.text : step;
        var stepNotes = typeof step === 'object' ? step.notes : '';
        return (stepText && stepText.trim() !== '') || (stepNotes && stepNotes.trim() !== '');
      });
      if (stepDirty) return true;

      return false;
    } else {
      // In modifica: controlla differenze rispetto alla ricetta originale
      if ((current.name || '') !== (original.name || '')) return true;
      if ((current.category || '') !== (original.category || '')) return true;
      if ((current.description || '') !== (original.description || '')) return true;
      if ((current.notes || '') !== (original.notes || '')) return true;
      if ((current.storage || '') !== (original.storage || '')) return true;
      if ((current.image || '') !== (original.image || '')) return true;
      if ((current.prepTime || '') != (original.prepTime || '')) return true;
      if ((current.cookTime || '') != (original.cookTime || '')) return true;
      if ((current.servings || '') != (original.servings || '')) return true;
      if ((current.difficulty || '') !== (original.difficulty || '')) return true;

      // Ingredienti
      if (current.ingredients.length !== original.ingredients.length) return true;
      for (var i = 0; i < current.ingredients.length; i++) {
        var cIng = current.ingredients[i];
        var oIng = original.ingredients[i];
        if (!oIng) return true;
        if ((cIng.name || '') !== (oIng.name || '')) return true;
        if ((cIng.quantity || '') !== (oIng.quantity || '')) return true;
        if ((cIng.unit || '') !== (oIng.unit || '')) return true;
        if ((cIng.notes || '') !== (oIng.notes || '')) return true;
      }

      // Passaggi
      if (current.steps.length !== original.steps.length) return true;
      for (var j = 0; j < current.steps.length; j++) {
        var cStep = current.steps[j];
        var oStep = original.steps[j];
        var cText = typeof cStep === 'object' ? cStep.text : cStep;
        var cNotes = typeof cStep === 'object' ? cStep.notes : '';
        var oText = typeof oStep === 'object' ? oStep.text : oStep;
        var oNotes = typeof oStep === 'object' ? oStep.notes : '';
        if ((cText || '') !== (oText || '')) return true;
        if ((cNotes || '') !== (oNotes || '')) return true;
      }

      return false;
    }
  }

  // Mappa chiave-errore (restituita da Recipes.validate) -> span di errore + tab da aprire.
  // Instradare per CHIAVE invece che cercando parole nel testo del messaggio evita
  // collisioni tipo "Ingrediente 1: il nome è obbligatorio" (contiene "nome") che finiva
  // nello slot del nome ricetta invece che in quello degli ingredienti.
  var FIELD_ERROR_MAP = {
    name: { spanId: 'error-name', tab: 'tab-info', selector: '#input-name' },
    category: { spanId: 'error-category', tab: 'tab-info', selector: '.category-selector-grid' },
    description: { spanId: 'error-description', tab: 'tab-info', selector: '#input-description' },
    notes: { spanId: 'error-notes', tab: 'tab-info', selector: '#input-notes' },
    storage: { spanId: 'error-storage', tab: 'tab-info', selector: '#input-storage' },
    prepTime: { spanId: 'error-preptime', tab: 'tab-cook', selector: '#input-preptime' },
    cookTime: { spanId: 'error-cooktime', tab: 'tab-cook', selector: '#input-cooktime' },
    servings: { spanId: 'error-servings', tab: 'tab-cook', selector: '#input-servings' },
    difficulty: { spanId: 'error-difficulty', tab: 'tab-cook', selector: '#input-difficulty' },
    ingredients: { spanId: 'error-ingredients', tab: 'tab-prep', selector: '#ingredients-list [data-field="ing-name"]' },
    steps: { spanId: 'error-steps', tab: 'tab-prep', selector: '#steps-list [data-field="step-text"]' }
  };
  // Priorità di apertura tab quando ci sono errori su più tab insieme:
  // Info > Preparazione > Cottura (si apre sempre la tab più "a monte").
  var TAB_OPEN_PRIORITY = { 'tab-info': 0, 'tab-prep': 1, 'tab-cook': 2 };

  function showFormErrors(errors) {
    var switchTarget = null;
    var firstInvalidControl = null;

    // errors è un oggetto { fieldName: "messaggio" }; fieldName può essere un nome
    // fisso (name, category, prepTime...) oppure "ingredient_0", "step_2", ecc.
    Object.keys(errors).forEach(function (key) {
      var message = errors[key];
      if (!message) return;

      var mapping = FIELD_ERROR_MAP[key];
      if (!mapping) {
        if (key.indexOf('ingredient_') === 0) {
          mapping = {
            spanId: FIELD_ERROR_MAP.ingredients.spanId,
            tab: FIELD_ERROR_MAP.ingredients.tab,
            selector: '#ingredients-list .ingredient-row[data-index="' + key.slice('ingredient_'.length) + '"] [data-field="ing-name"]'
          };
        } else if (key.indexOf('step_') === 0) {
          mapping = {
            spanId: FIELD_ERROR_MAP.steps.spanId,
            tab: FIELD_ERROR_MAP.steps.tab,
            selector: '#steps-list .step-item[data-index="' + key.slice('step_'.length) + '"] [data-field="step-text"]'
          };
        }
      }
      if (!mapping) return; // chiave senza slot dedicato (es. _general): nessun posto dove mostrarla

      var invalidControl = setFieldError(mapping.spanId, message, mapping.selector);
      if (!firstInvalidControl && invalidControl) firstInvalidControl = invalidControl;

      if (switchTarget === null || TAB_OPEN_PRIORITY[mapping.tab] < TAB_OPEN_PRIORITY[switchTarget]) {
        switchTarget = mapping.tab;
      }
    });

    if (switchTarget) {
      switchFormTab(switchTarget);
    }
    if (firstInvalidControl) {
      window.requestAnimationFrame(function () {
        firstInvalidControl.focus();
      });
    }
  }

  function setFieldError(errorId, message, selector) {
    var el = document.getElementById(errorId);
    if (!el) return null;
    el.textContent = el.textContent ? el.textContent + ' • ' + message : message;
    el.setAttribute('role', 'alert');
    var group = el.closest('.form-group');
    if (group) group.classList.add('has-error');
    var control = selector ? document.querySelector(selector) : null;
    if (control) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', errorId);
    }
    return control;
  }

  /* ──────────────────── FORM: SAVE ──────────────────── */

  async function saveRecipe() {
    if (state.savingRecipe) return;
    var formAtSave = document.getElementById('recipe-form');
    if (!formAtSave) return;
    var draftSessionAtSave = state.draftSession;
    var editingRecipeAtSave = state.editingRecipe;
    var routeTokenAtSave = state.routeToken;
    var hashAtSave = window.location.hash;
    var submitButton = formAtSave.querySelector('button[type="submit"]');
    var previousBusy = appContent.getAttribute('aria-busy');
    var wasInert = appContent.inert === true;
    var successMessage = null;
    var shouldNavigateHome = false;

    state.savingRecipe = true;
    appContent.inert = true;
    appContent.setAttribute('aria-busy', 'true');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
    }

    try {
      var pendingImage = state.imageProcessingPromise;
      if (pendingImage) {
        var imageReady = await pendingImage;
        if (!imageReady) {
          Utils.showToast(
            'La foto non è stata preparata. Riprova oppure rimuovila prima di salvare.',
            'error'
          );
          return;
        }
      }

      if (
        state.draftSession !== draftSessionAtSave ||
        state.routeToken !== routeTokenAtSave ||
        window.location.hash !== hashAtSave ||
        document.getElementById('recipe-form') !== formAtSave
      ) {
        Utils.showToast(
          'Il modulo è cambiato durante il salvataggio. Controlla i dati e riprova.',
          'warning'
        );
        return;
      }

      clearFormErrors();
      var recipe = collectFormData();
      var validation = Recipes.validate(recipe);
      if (!validation.valid) {
        showFormErrors(validation.errors);
        Utils.showToast('Correggi gli errori nel modulo', 'error');
        return;
      }

      if (editingRecipeAtSave) {
        await DB.updateRecipe(recipe);
        successMessage = 'Ricetta aggiornata con successo! ✅';
      } else {
        await DB.addRecipe(recipe);
        successMessage = 'Ricetta creata con successo! 🎉';
      }

      try {
        var draftDiscardResult = await discardDraftSession(draftSessionAtSave);
        if (state.draftSession === draftSessionAtSave) {
          state.draftSession = null;
          state.draftBaseRecipe = null;
        }
        if (draftDiscardResult && draftDiscardResult.status === 'conflict') {
          Utils.showToast(
            'Ricetta salvata; la bozza dell’altra scheda è stata mantenuta.',
            'warning'
          );
        }
      } catch (draftError) {
        console.warn('Ricetta salvata, ma la bozza non è stata rimossa:', draftError);
        if (draftSessionAtSave) {
          await draftSessionAtSave.close({
            flush: false,
            forceClose: true
          }).catch(function () {});
        }
        if (state.draftSession === draftSessionAtSave) {
          state.draftSession = null;
          state.draftBaseRecipe = null;
        }
        Utils.showToast(
          'Ricetta salvata, ma non ho potuto ripulire la vecchia bozza.',
          'warning'
        );
      }
      shouldNavigateHome =
        state.routeToken === routeTokenAtSave &&
        window.location.hash === hashAtSave &&
        document.getElementById('recipe-form') === formAtSave;
    } catch (e) {
      if (e && e.code === 'RECIPE_CONFLICT') {
        if (draftSessionAtSave) {
          await draftSessionAtSave.flush().catch(function (draftError) {
            console.warn('Impossibile aggiornare la bozza in conflitto:', draftError);
          });
        }
        Utils.showToast(
          'La ricetta è cambiata in un’altra scheda. La tua bozza resta al sicuro: riapri la ricetta e confronta le modifiche.',
          'warning'
        );
      } else {
        Utils.showToast('Errore nel salvataggio: ' + e.message, 'error');
      }
    } finally {
      state.savingRecipe = false;
      appContent.inert = wasInert;
      if (previousBusy === null) {
        appContent.removeAttribute('aria-busy');
      } else {
        appContent.setAttribute('aria-busy', previousBusy);
      }
      if (submitButton && submitButton.isConnected) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
      }
    }

    if (successMessage) {
      Utils.showToast(successMessage, 'success');
      if (shouldNavigateHome) navigateTo('#home', true);
    }
  }

  async function confirmDeleteCustomCategory(catId) {
    var category = Recipes.CATEGORIES.find(function (cat) { return cat.id === catId && cat.isCustom; });
    if (!category) return;
    var affected = await DB.countRecipes(catId);
    var message = affected > 0
      ? 'La categoria “' + category.label + '” è usata da ' + affected + ' ricett' + (affected === 1 ? 'a' : 'e') + '. Eliminandola, verr' + (affected === 1 ? 'à spostata' : 'anno spostate') + ' automaticamente in “Altro”.'
      : 'Eliminare la categoria “' + category.label + '”?';
    Views.showConfirmModal('Elimina categoria', message, async function () {
      Views.hideModal();
      await deleteCustomCategory(catId);
    });
  }

  /* ──────────────────── FORM: DYNAMIC ROWS ──────────────────── */

  function addIngredientRow() {
    var list = document.getElementById('ingredients-list');
    if (!list) return;
    var rows = list.querySelectorAll('.ingredient-row');
    if (rows.length >= Recipes.LIMITS.ingredients) {
      Utils.showToast('Hai raggiunto il limite di ingredienti.', 'warning');
      return;
    }
    // Re-render all rows with correct indices and remove buttons
    var ingredients = collectCurrentIngredients();
    ingredients.push({ name: '', quantity: '', unit: '' });
    rerenderIngredients(ingredients);
  }

  function removeIngredientRow(index) {
    var ingredients = collectCurrentIngredients();
    if (ingredients.length <= 1) return;
    ingredients.splice(index, 1);
    rerenderIngredients(ingredients);
  }

  function collectCurrentIngredients() {
    var rows = document.querySelectorAll('#ingredients-list .ingredient-row');
    var ingredients = [];
    rows.forEach(function (row) {
      var nameEl = row.querySelector('[data-field="ing-name"]');
      var qtyEl = row.querySelector('[data-field="ing-qty"]');
      var unitEl = row.querySelector('[data-field="ing-unit"]');
      var notesEl = row.querySelector('[data-field="ing-notes"]');
      ingredients.push({
        name: nameEl ? nameEl.value : '',
        quantity: qtyEl ? qtyEl.value : '',
        unit: unitEl ? unitEl.value : '',
        notes: notesEl ? notesEl.value : ''
      });
    });
    return ingredients;
  }

  function rerenderIngredients(ingredients) {
    var list = document.getElementById('ingredients-list');
    if (!list) return;
    list.innerHTML = Views.ingredientRowsHTML(ingredients);
    scheduleCurrentDraft();
  }

  function addStepRow() {
    var steps = collectCurrentSteps();
    if (steps.length >= Recipes.LIMITS.steps) {
      Utils.showToast('Hai raggiunto il limite di passaggi.', 'warning');
      return;
    }
    steps.push({ text: '', notes: '' });
    rerenderSteps(steps);
  }

  function removeStepRow(index) {
    var steps = collectCurrentSteps();
    if (steps.length <= 1) return;
    steps.splice(index, 1);
    rerenderSteps(steps);
  }

  function collectCurrentSteps() {
    var rows = document.querySelectorAll('#steps-list .step-item');
    var steps = [];
    rows.forEach(function (row) {
      var textEl = row.querySelector('[data-field="step-text"]');
      var notesEl = row.querySelector('[data-field="step-notes"]');
      steps.push({
        text: textEl ? textEl.value : '',
        notes: notesEl ? notesEl.value : ''
      });
    });
    return steps;
  }

  function rerenderSteps(steps) {
    var list = document.getElementById('steps-list');
    if (!list) return;
    list.innerHTML = Views.stepRowsHTML(steps);
    scheduleCurrentDraft();
  }

  /* ──────────────────── IMAGE HANDLING ──────────────────── */

  var imageRequestToken = 0;

  function invalidatePendingImageProcessing() {
    imageRequestToken += 1;
    state.imageProcessingPromise = null;
  }

  function triggerImageUpload() {
    var fileInput = document.getElementById('input-image');
    if (fileInput) fileInput.click();
  }

  async function handleImageFile(file) {
    var targetForm = document.getElementById('recipe-form');
    var targetSession = state.draftSession;
    var fileInput = targetForm && targetForm.querySelector('#input-image');
    if (!file || !targetForm || !targetSession) return false;
    if (!Utils.ALLOWED_IMAGE_TYPES.includes(String(file.type || '').toLowerCase())) {
      if (fileInput) fileInput.value = '';
      Utils.showToast('Formato non supportato. Usa JPEG, PNG o WebP', 'error');
      return false;
    }
    if (file.size > Utils.MAX_IMAGE_FILE_BYTES) {
      if (fileInput) fileInput.value = '';
      Utils.showToast('La foto supera il limite di 12 MB', 'error');
      return false;
    }

    var requestToken = ++imageRequestToken;
    var uploadArea = targetForm.querySelector('#image-upload-area');
    var imageDataInput = targetForm.querySelector('#input-image-data');
    var thumbnailDataInput = targetForm.querySelector('#input-image-thumbnail-data');
    var isCurrentTarget = function () {
      return requestToken === imageRequestToken &&
        targetSession === state.draftSession &&
        targetForm === document.getElementById('recipe-form') &&
        targetForm.isConnected;
    };
    if (uploadArea) uploadArea.setAttribute('aria-busy', 'true');
    try {
      var base64 = await Utils.compressImage(file, 1280);
      if (!isCurrentTarget()) return false;
      var thumbnail = await Utils.createImageThumbnail(base64, 360);
      if (!isCurrentTarget() || !imageDataInput || !thumbnailDataInput || !uploadArea) {
        return false;
      }
      imageDataInput.value = base64;
      thumbnailDataInput.value = thumbnail;

      uploadArea.innerHTML =
        '<div class="image-upload__preview">' +
          '<button type="button" class="image-upload__change" data-action="trigger-image-upload" aria-label="Cambia foto">' +
            '<img src="' + Utils.escapeHtml(base64) + '" alt="Anteprima" id="image-preview">' +
          '</button>' +
          '<button type="button" class="image-upload__remove" data-action="remove-image" aria-label="Rimuovi foto">✕</button>' +
        '</div>';
      targetSession.schedule();
      return true;
    } catch (e) {
      if (isCurrentTarget()) {
        Utils.showToast(e && e.message ? e.message : 'Errore nel caricamento dell’immagine', 'error');
      }
      return false;
    } finally {
      if (isCurrentTarget() && uploadArea) {
        uploadArea.removeAttribute('aria-busy');
      }
      if (fileInput) fileInput.value = '';
    }
  }

  function removeImage() {
    invalidatePendingImageProcessing();
    var form = document.getElementById('recipe-form');
    if (!form) return;
    var imageDataInput = form.querySelector('#input-image-data');
    var thumbnailDataInput = form.querySelector('#input-image-thumbnail-data');
    if (imageDataInput) imageDataInput.value = '';
    if (thumbnailDataInput) thumbnailDataInput.value = '';
    var fileInput = form.querySelector('#input-image');
    if (fileInput) fileInput.value = '';

    var uploadArea = form.querySelector('#image-upload-area');
    if (!uploadArea) return;
    uploadArea.innerHTML =
      '<button type="button" class="image-upload__placeholder" id="image-placeholder" data-action="trigger-image-upload">' +
        '<span style="font-size:2rem">📷</span>' +
        '<span>Tocca per aggiungere una foto</span>' +
      '</button>';
    scheduleCurrentDraft();
  }

  /* ──────────────────── EXPORT / IMPORT ──────────────────── */

  async function exportData() {
    try {
      var json = await DB.exportData();
      var date = new Date().toISOString().slice(0, 10);
      Utils.triggerDownload(json, 'sapori-backup-' + date + '.json', 'application/json');
      var backupAt = Date.now();
      try {
        await DB.setSetting('lastBackupAt', backupAt);
        var status = document.getElementById('last-backup-status');
        if (status) {
          status.textContent = new Date(backupAt).toLocaleString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
        }
      } catch (settingError) {
        console.warn('Impossibile registrare la data del backup:', settingError);
      }
      Utils.showToast('Esportazione completata! 📥', 'success');
    } catch (e) {
      Utils.showToast('Errore nell\'esportazione', 'error');
    }
  }

  async function exportAllRecipesPDF() {
    if (state.exportingPDF) {
      Utils.showToast('La preparazione del ricettario è già in corso.', 'warning');
      return;
    }

    state.exportingPDF = true;
    var printDiv = null;
    var progressView = null;
    var controller = new AbortController();

    try {
      // Le miniature sono sufficienti su carta e impediscono di caricare
      // contemporaneamente tutte le fotografie originali.
      var recipes = await DB.getRecipeSummaries();
      if (!recipes || recipes.length === 0) {
        Utils.showToast('Nessuna ricetta da esportare! 🍳', 'error');
        return;
      }

      progressView = PrintProgressView.open({
        onCancel: function () {
          controller.abort();
        }
      });
      await new Promise(function (resolve) {
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            if (recipes.length >= 100) {
              window.setTimeout(resolve, 750);
            } else {
              resolve();
            }
          });
        });
      });
      if (controller.signal.aborted) {
        throw new DOMException('Preparazione annullata', 'AbortError');
      }

      printDiv = await CookbookBuilder.build(recipes, {
        buildRecipeHTML: Views.buildPrintableRecipeHTML,
        getCategoryInfo: Utils.getCategoryInfo,
        appUrl: new URL('./', window.location.href).href,
        signal: controller.signal,
        batchSize: 20,
        onProgress: function (progress) {
          progressView.update(progress);
        }
      });

      if (controller.signal.aborted) {
        throw new DOMException('Preparazione annullata', 'AbortError');
      }

      document.body.appendChild(printDiv);
      progressView.update({ message: 'Apro le opzioni di stampa…' });
      progressView.close();
      progressView = null;

      var result = await PrintService.printDocument(printDiv, {
        bodyClass: 'printing-all-recipes',
        title: 'Il mio ricettario — Sapori',
        signal: controller.signal,
        imageConcurrency: 4
      });
      printDiv = null;

      if (result.completion.source === 'safety-timeout') {
        Utils.showToast(
          'La stampa non ha comunicato la chiusura: l’app è stata ripristinata in sicurezza.',
          'warning'
        );
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        Utils.showToast('Preparazione del ricettario annullata.', 'info');
      } else {
        console.error(err);
        Utils.showToast('Errore durante la creazione del PDF', 'error');
      }
    } finally {
      if (progressView) progressView.close();
      if (printDiv && printDiv.parentNode) printDiv.parentNode.removeChild(printDiv);
      state.exportingPDF = false;
    }
  }


  async function importData() {
    var fileInput = document.getElementById('import-file-input');
    if (fileInput) fileInput.click();
  }

  async function handleImportFile(file) {
    if (!file) return;
    if (file.size > DB.MAX_IMPORT_BYTES) {
      Utils.showToast('Il file supera il limite di 50 MB.', 'error');
      return;
    }
    try {
      var text = await Utils.readFileAsText(file);
      var preview = await DB.previewImport(text);
      var applyImport = async function (mode) {
        Views.hideModal();
        try {
          var summary = await DB.importData(text, { mode: mode });
          await loadCustomCategories();
          await Theme.init();
          var parts = [];
          if (summary.imported) parts.push(summary.imported + ' nuove');
          if (summary.updated) parts.push(summary.updated + ' aggiornate');
          if (summary.skipped) parts.push(summary.skipped + ' duplicate ignorate');
          if (summary.conflicts) parts.push(summary.conflicts + ' conflitti locali preservati');
          if (summary.rejected) parts.push(summary.rejected + ' non valide');
          Utils.showToast('Importazione completata: ' + (parts.join(', ') || 'nessuna modifica') + '.', 'success');
          if (state.currentView === 'settings') {
            renderActiveView('settings', function (container) {
              return Views.renderSettings(container);
            });
          }
        } catch (importError) {
          Utils.showToast('Errore nell\'importazione: ' + importError.message, 'error');
        }
      };
      Views.showImportPreviewModal(
        preview,
        function () { applyImport('merge'); },
        preview.isBackup ? function () { applyImport('replace'); } : null
      );
    } catch (e) {
      Utils.showToast('Errore nell\'importazione: ' + e.message, 'error');
    } finally {
      var fileInput = document.getElementById('import-file-input');
      if (fileInput) fileInput.value = '';
    }
  }

  /* ──────────────────── DELETE RECIPE ──────────────────── */

  function confirmDeleteRecipe(id) {
    Views.showConfirmModal(
      'Elimina Ricetta',
      'Sei sicuro di voler eliminare questa ricetta? Questa azione non può essere annullata.',
      async function () {
        try {
          await DB.deleteRecipe(id);
          Views.hideModal();
          Utils.showToast('Ricetta eliminata 🗑️', 'success');
          navigateTo('#home');
        } catch (e) {
          Utils.showToast('Errore nell\'eliminazione', 'error');
        }
      }
    );
  }

  /* ──────────────────── EVENT LISTENERS ──────────────────── */

  function setupEventListeners() {
    // Bottom nav
    bottomNav.addEventListener('click', function (e) {
      var navItem = e.target.closest('.nav-item');
      if (!navItem) return;
      var view = navItem.getAttribute('data-view');
      if (view) navigateTo('#' + view);
    });

    // Search toggle
    btnSearchToggle.addEventListener('click', function () {
      if (searchBar.classList.contains('hidden')) {
        openSearch();
      } else {
        closeSearch(true, true);
      }
    });

    // Search close
    btnSearchClose.addEventListener('click', function () {
      closeSearch(true, true);
    });

    // Search input
    searchInput.addEventListener('input', function (e) {
      debouncedSearch(e.target.value.trim());
    });

    // Escape key closes search
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSearch(true, true);
    });

    // Theme toggle
    btnThemeToggle.addEventListener('click', async function () {
      await Theme.toggleDarkMode();
    });

    // Modal overlay click (close)
    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) {
        if (document.getElementById('cooking-modal-inner')) closeCookingSession();
        else Views.hideModal();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && state.draftSession) {
        state.draftSession.flush().catch(function (error) {
          console.warn('Autosalvataggio della bozza non riuscito:', error);
        });
      }
      if (document.visibilityState === 'visible' &&
          state.cooking.recipe &&
          !modalOverlay.classList.contains('hidden')) {
        requestWakeLock().then(function () {
          rerenderCookingModal();
        });
      }
    });

    window.addEventListener('beforeunload', function (e) {
      if (hasUnsavedForm()) {
        if (state.draftSession) {
          state.draftSession.flush().catch(function () {});
        }
        e.preventDefault();
        e.returnValue = '';
      }
    });

    document.addEventListener('keydown', function (e) {
      var tabButton = e.target.closest && e.target.closest('.form-steps-btn');
      if (tabButton && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        var tabs = Array.from(document.querySelectorAll('.form-steps-btn'));
        var index = tabs.indexOf(tabButton);
        var nextIndex = e.key === 'Home' ? 0 :
          e.key === 'End' ? tabs.length - 1 :
          (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        e.preventDefault();
        tabs[nextIndex].focus();
        tabs[nextIndex].click();
      }

      var radio = e.target.closest && e.target.closest('.category-select-btn');
      if (radio && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        var radios = Array.from(document.querySelectorAll('.category-select-btn'));
        var radioIndex = radios.indexOf(radio);
        var direction = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        var nextRadio = e.key === 'Home'
          ? radios[0]
          : e.key === 'End'
            ? radios[radios.length - 1]
            : radios[(radioIndex + direction + radios.length) % radios.length];
        e.preventDefault();
        nextRadio.focus();
        nextRadio.click();
      }

      var paletteOption = e.target.closest && e.target.closest('.theme-option');
      if (paletteOption && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        var paletteOptions = Array.from(
          paletteOption.closest('.theme-selector').querySelectorAll('.theme-option')
        );
        var paletteIndex = paletteOptions.indexOf(paletteOption);
        var paletteDirection = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        var nextPalette = e.key === 'Home'
          ? paletteOptions[0]
          : e.key === 'End'
            ? paletteOptions[paletteOptions.length - 1]
            : paletteOptions[
              (paletteIndex + paletteDirection + paletteOptions.length) % paletteOptions.length
            ];
        e.preventDefault();
        nextPalette.click();
      }
    });

    document.addEventListener('input', function (e) {
      if (e.target.closest && e.target.closest('#recipe-form')) {
        scheduleCurrentDraft();
      }
    });

    // File input for image
    document.addEventListener('change', function (e) {
      if (e.target.id === 'input-image') {
        var file = e.target.files && e.target.files[0];
        if (file) {
          var imageProcessingPromise = handleImageFile(file);
          state.imageProcessingPromise = imageProcessingPromise;
          imageProcessingPromise.then(function () {
            if (state.imageProcessingPromise === imageProcessingPromise) {
              state.imageProcessingPromise = null;
            }
          }, function () {
            if (state.imageProcessingPromise === imageProcessingPromise) {
              state.imageProcessingPromise = null;
            }
          });
        }
      }
      if (e.target.id === 'import-file-input') {
        var importFile = e.target.files && e.target.files[0];
        if (importFile) handleImportFile(importFile);
      }
      // Sort select
      if (e.target.id === 'sort-select') {
        state.filters.sortBy = e.target.value;
        if (state.currentView === 'home') {
          renderActiveView('home', function (container) {
            return Views.renderHome(container, state.filters);
          });
        }
      }
      if (
        e.target.closest &&
        e.target.closest('#recipe-form') &&
        e.target.id !== 'input-image'
      ) {
        scheduleCurrentDraft();
      }
    });

    document.addEventListener('submit', function (e) {
      if (e.target.id === 'pantry-form') {
        e.preventDefault();
        var input = document.getElementById('pantry-input');
        if (input && input.value.trim().length > 0) {
          input.value.split(',').map(function (value) {
            return value.trim();
          }).filter(Boolean).forEach(function (value) {
            if (!state.pantryIngredients.some(function(u) {
              return u.toLocaleLowerCase('it-IT') === value.toLocaleLowerCase('it-IT');
            })) {
              state.pantryIngredients.push(value);
            }
          });
          renderActiveView('pantry', function (container) {
            return Views.renderPantry(container, state.pantryIngredients);
          }).then(function (rendered) {
            if (!rendered) return;
            var nextInput = document.getElementById('pantry-input');
            if (nextInput) nextInput.focus();
          });
        }
      }
    });

    // Global delegated click handler for dynamic content
    document.addEventListener('click', function (e) {
      var target = e.target;
      var actionEl = target.closest('[data-action]');
      if (!actionEl) return;

      var action = actionEl.getAttribute('data-action');

      switch (action) {
        /* ── Navigation actions ── */
        case 'open-recipe': {
          if (actionEl.tagName === 'A') e.preventDefault();
          var id = actionEl.getAttribute('data-id');
          if (id) navigateTo('#detail/' + encodeURIComponent(id));
          break;
        }
        case 'go-home': {
          navigateTo('#home');
          break;
        }
        case 'go-create': {
          navigateTo('#create');
          break;
        }
        case 'open-drafts': {
          navigateTo('#drafts');
          break;
        }
        case 'resume-draft': {
          resumeDraft(actionEl);
          break;
        }
        case 'delete-draft': {
          confirmDeleteDraft(actionEl);
          break;
        }
        case 'go-account': {
          navigateTo('#account');
          break;
        }
        case 'go-settings': {
          navigateTo('#settings');
          break;
        }
        case 'prepare-sync': {
          actionEl.disabled = true;
          actionEl.setAttribute('aria-busy', 'true');
          actionEl.textContent = 'Preparazione in corso…';
          SyncPreparation.prepareDevice()
            .then(function () {
              Utils.showToast('Dispositivo preparato: nessun dato è stato inviato online', 'success');
              return renderActiveView('account', function (container) {
                return AccountView.render(container);
              });
            })
            .then(function (rendered) {
              if (rendered) AccountView.focusHeading(appContent);
            })
            .catch(function (error) {
              console.error('Errore durante la preparazione locale:', error);
              Utils.showToast('Impossibile preparare la sincronizzazione', 'error');
              actionEl.disabled = false;
              actionEl.removeAttribute('aria-busy');
              actionEl.textContent = 'Prepara questo dispositivo';
            });
          break;
        }
        case 'start-cooking': {
          var cookId = actionEl.getAttribute('data-id');
          if (cookId) {
            DB.getRecipe(cookId).then(async function (r) {
              if (r) {
                stopTimer();
                await releaseWakeLock();
                state.cooking = {
                  recipe: r,
                  stepIndex: 0,
                  checkedIngredients: {},
                  wakeLockSentinel: null,
                  ingExpanded: true,
                  timer: { minutes: 0, seconds: 0, running: false, intervalId: null, endAt: null }
                };
                await requestWakeLock();
                rerenderCookingModal();
              }
            }).catch(function () {
              Utils.showToast('Impossibile avviare la modalità cucina', 'error');
            });
          }
          break;
        }
        case 'cooking-prev': {
          var pStep = parseInt(actionEl.getAttribute('data-step'), 10);
          if (!isNaN(pStep) && pStep >= 0 && state.cooking && state.cooking.recipe) {
            state.cooking.stepIndex = pStep;
            rerenderCookingModal();
          }
          break;
        }
        case 'cooking-next': {
          var nStep = parseInt(actionEl.getAttribute('data-step'), 10);
          if (!isNaN(nStep) && state.cooking && state.cooking.recipe) {
            // Allow going to finish screen (nStep === totalSteps)
            state.cooking.stepIndex = nStep;
            rerenderCookingModal();
          }
          break;
        }
        case 'cooking-goto': {
          var gStep = parseInt(actionEl.getAttribute('data-step'), 10);
          if (!isNaN(gStep) && gStep >= 0 && state.cooking && state.cooking.recipe) {
            state.cooking.stepIndex = gStep;
            rerenderCookingModal();
          }
          break;
        }
        case 'toggle-cooking-ing': {
          var cIdx = parseInt(actionEl.getAttribute('data-index'), 10);
          if (!isNaN(cIdx) && state.cooking) {
            state.cooking.checkedIngredients[cIdx] = !state.cooking.checkedIngredients[cIdx];
            rerenderCookingModal();
          }
          break;
        }
        case 'toggle-cooking-ing-panel': {
          if (state.cooking) {
            state.cooking.ingExpanded = !state.cooking.ingExpanded;
            rerenderCookingModal();
          }
          break;
        }
        case 'cooking-timer-start': {
          startTimer();
          break;
        }
        case 'cooking-timer-pause': {
          stopTimer();
          rerenderCookingModal();
          break;
        }
        case 'cooking-timer-reset': {
          resetTimer();
          break;
        }
        case 'close-cooking': {
          closeCookingSession();
          break;
        }
        case 'scale-servings-down': {
          updateServingsScale(-1);
          break;
        }
        case 'scale-servings-up': {
          updateServingsScale(1);
          break;
        }
        case 'go-pantry': {
          navigateTo('#pantry');
          break;
        }
        case 'add-quick-pantry': {
          var quickIng = actionEl.getAttribute('data-ingredient');
          if (quickIng && !state.pantryIngredients.some(function(u){ return u.toLowerCase() === quickIng.toLowerCase(); })) {
            state.pantryIngredients.push(quickIng);
            renderActiveView('pantry', function (container) {
              return Views.renderPantry(container, state.pantryIngredients);
            });
          }
          break;
        }
        case 'remove-pantry-ingredient': {
          var pIdx = parseInt(actionEl.getAttribute('data-index'), 10);
          if (!isNaN(pIdx) && pIdx >= 0 && pIdx < state.pantryIngredients.length) {
            state.pantryIngredients.splice(pIdx, 1);
            renderActiveView('pantry', function (container) {
              return Views.renderPantry(container, state.pantryIngredients);
            });
          }
          break;
        }
        case 'clear-pantry': {
          state.pantryIngredients = [];
          renderActiveView('pantry', function (container) {
            return Views.renderPantry(container, state.pantryIngredients);
          });
          break;
        }
        case 'go-back': {
          navigateTo(isDetailReturnHash(state.detailReturnHash) ? state.detailReturnHash : '#home');
          break;
        }
        case 'edit-recipe': {
          var editId = actionEl.getAttribute('data-id');
          if (editId) navigateTo('#edit/' + encodeURIComponent(editId));
          break;
        }
        case 'export-pdf': {
          var pdfId = actionEl.getAttribute('data-id');
          if (pdfId) {
            actionEl.disabled = true;
            DB.getRecipe(pdfId).then(async function (recipe) {
              if (recipe && window.Views) {
                await Views.printRecipePDF(recipe);
              }
            }).catch(function () {
              Utils.showToast('Impossibile preparare il PDF', 'error');
            }).finally(function () {
              actionEl.disabled = false;
            });
          } else {
            // Fallback: print current page
            window.print();
          }
          break;
        }
        /* ── Favorite toggle ── */
        case 'toggle-fav': {
          e.stopPropagation();
          var favId = actionEl.getAttribute('data-id');
          toggleFavorite(favId).then(function (isFav) {
            if (isFav !== null) {
              // Re-render current view
              if (state.currentView === 'home') {
                renderActiveView('home', function (container) {
                  return Views.renderHome(container, state.filters);
                });
              } else if (state.currentView === 'favorites') {
                renderActiveView('favorites', function (container) {
                  return Views.renderFavorites(container);
                });
              }
            }
          });
          break;
        }
        case 'toggle-fav-detail': {
          e.stopPropagation();
          var favDetailId = actionEl.getAttribute('data-id');
          toggleFavorite(favDetailId).then(function (isFav) {
            if (isFav !== null) {
              // Update the button in place
              actionEl.classList.toggle('is-favorite', isFav);
              actionEl.innerHTML = isFav ? Icons.heartFilled : Icons.heartOutline;
              actionEl.setAttribute('aria-pressed', String(isFav));
              actionEl.setAttribute('aria-label', isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti');
            }
          });
          break;
        }

        /* ── Delete ── */
        case 'delete-recipe': {
          var deleteId = actionEl.getAttribute('data-id');
          if (deleteId) confirmDeleteRecipe(deleteId);
          break;
        }

        /* ── Category filter ── */
        case 'filter-category': {
          var cat = actionEl.getAttribute('data-category');
          state.filters.category = cat || '';
          renderActiveView('home', function (container) {
            return Views.renderHome(container, state.filters);
          });
          break;
        }
        case 'retry-route': {
          navigateTo(window.location.hash || '#home', true);
          break;
        }

        /* ── Form: custom category select ── */
        case 'select-form-category': {
          var selectedCat = actionEl.getAttribute('data-category');
          var hiddenInput = document.getElementById('input-category');
          if (hiddenInput) {
            hiddenInput.value = selectedCat;
            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
          var grid = actionEl.closest('.category-selector-grid');
          if (grid) {
            grid.querySelectorAll('.category-select-btn').forEach(function (btn) {
              btn.classList.remove('active');
              btn.setAttribute('aria-checked', 'false');
              btn.setAttribute('tabindex', '-1');
            });
          }
          actionEl.classList.add('active');
          actionEl.setAttribute('aria-checked', 'true');
          actionEl.setAttribute('tabindex', '0');
          break;
        }

        /* ── Form: dynamic rows ── */
        case 'add-ingredient': {
          addIngredientRow();
          break;
        }
        case 'remove-ingredient': {
          var ingIdx = parseInt(actionEl.getAttribute('data-index'), 10);
          removeIngredientRow(ingIdx);
          break;
        }
        case 'add-step': {
          addStepRow();
          break;
        }
        case 'remove-step': {
          var stepIdx = parseInt(actionEl.getAttribute('data-index'), 10);
          removeStepRow(stepIdx);
          break;
        }

        /* ── Form: image ── */
        case 'remove-image': {
          e.stopPropagation();
          removeImage();
          break;
        }
        case 'trigger-image-upload': {
          triggerImageUpload();
          break;
        }

        /* ── Form: tabs ── */
        case 'next-tab': {
          var nextId = actionEl.getAttribute('data-next');
          if (nextId) {
            switchFormTab(nextId, true);
            scheduleCurrentDraft();
          }
          break;
        }
        case 'prev-tab': {
          var prevId = actionEl.getAttribute('data-prev');
          if (prevId) {
            switchFormTab(prevId, true);
            scheduleCurrentDraft();
          }
          break;
        }
        case 'switch-tab': {
          var targetId = actionEl.getAttribute('data-target');
          if (targetId) {
            switchFormTab(targetId);
            scheduleCurrentDraft();
          }
          break;
        }

        /* ── Form: cancel ── */
        case 'duplicate-conflicted-draft': {
          duplicateConflictedDraft();
          break;
        }
        case 'reload-conflicted-draft': {
          confirmReloadConflictedDraft();
          break;
        }
        case 'discard-draft': {
          var discardTarget = state.editingRecipe
            ? '#edit/' + encodeURIComponent(state.editingRecipe.id)
            : '#create';
          Views.showConfirmModal(
            'Scartare la bozza?',
            state.editingRecipe
              ? 'Le modifiche recuperate saranno eliminate e il modulo tornerà alla ricetta già salvata.'
              : 'Le modifiche recuperate saranno eliminate definitivamente da questo dispositivo.',
            function () {
              Views.hideModal();
              discardDraftAndNavigate(discardTarget);
            },
            {
              cancelLabel: 'Continua a modificare',
              confirmLabel: 'Scarta bozza',
              confirmClass: 'btn--danger'
            }
          );
          break;
        }
        case 'cancel-form': {
          var cancelTarget = state.editingRecipe
            ? '#detail/' + encodeURIComponent(state.editingRecipe.id)
            : '#home';

          if (isFormDirty()) {
            Views.showConfirmModal(
              'Scartare le modifiche?',
              'Annullando, la bozza locale e tutte le modifiche non salvate saranno eliminate definitivamente.',
              function () {
                Views.hideModal();
                discardDraftAndNavigate(cancelTarget);
              },
              {
                cancelLabel: 'Continua a modificare',
                confirmLabel: 'Scarta e chiudi',
                confirmClass: 'btn--danger'
              }
            );
          } else {
            discardDraftAndNavigate(cancelTarget);
          }
          break;
        }

        /* ── Settings: theme ── */
        case 'toggle-dark': {
          // Handled by the checkbox change, but also support click
          break;
        }
        case 'set-palette': {
          var palette = actionEl.getAttribute('data-palette');
          if (palette) {
            Theme.setPalette(palette).then(function () {
              // Re-render settings to update active state
              return renderActiveView('settings', function (container) {
                return Views.renderSettings(container);
              });
            }).then(function (rendered) {
              if (!rendered) return;
              var selectedPalette = document.querySelector(
                '.theme-option[data-palette="' + palette + '"]'
              );
              if (selectedPalette) selectedPalette.focus();
            });
          }
          break;
        }

        /* ── Settings: data ── */
        case 'add-category': {
          var labelInput = document.getElementById('input-cat-label');
          var iconInput = document.getElementById('input-cat-icon');
          var colorInput = document.getElementById('input-cat-color');
          
          if (!labelInput || !labelInput.value.trim()) {
            Utils.showToast('Inserisci un nome per la categoria 🏷️', 'error');
            return;
          }
          
          var label = labelInput.value.trim();
          var icon = iconInput ? iconInput.value.trim() : '🍴';
          var color = colorInput ? colorInput.value : '#E85D3A';
          var id = Utils.slugify(label);
          
          if (!id) id = 'cat-' + Date.now();
          
          var exists = Recipes.CATEGORIES.some(function(cat) {
            return cat.id === id;
          });
          
          if (exists) {
            Utils.showToast('Categoria già esistente', 'error');
            return;
          }
          
          var newCat = {
            id: id,
            label: label,
            icon: icon || '🍴',
            color: color,
            isCustom: true
          };
          
          saveCustomCategory(newCat);
          break;
        }
        case 'delete-category': {
          var catId = actionEl.getAttribute('data-id');
          if (catId) confirmDeleteCustomCategory(catId);
          break;
        }
        case 'export-pdf-all': {
          actionEl.disabled = true;
          actionEl.setAttribute('aria-busy', 'true');
          exportAllRecipesPDF().finally(function () {
            actionEl.disabled = false;
            actionEl.removeAttribute('aria-busy');
          });
          break;
        }
        case 'export-data': {
          actionEl.disabled = true;
          actionEl.setAttribute('aria-busy', 'true');
          exportData().finally(function () {
            actionEl.disabled = false;
            actionEl.removeAttribute('aria-busy');
          });
          break;
        }
        case 'import-data': {
          importData();
          break;
        }
        case 'request-storage-persistence': {
          actionEl.disabled = true;
          actionEl.setAttribute('aria-busy', 'true');
          StorageHealth.requestPersistence()
            .then(function (result) {
              var status = document.getElementById('storage-health-status');
              var health = status && status.closest('.storage-health');
              var granted = result.persisted === true ||
                result.persistenceGranted === true;

              if (result.requestError) {
                throw new Error(result.requestError);
              }

              if (granted) {
                if (status) {
                  status.textContent =
                    'Archivio protetto dalla pulizia automatica del browser.';
                }
                if (health) {
                  health.classList.remove(
                    'storage-health--unknown',
                    'storage-health--warning',
                    'storage-health--critical'
                  );
                  health.classList.add('storage-health--healthy');
                  var actions = health.querySelector('.storage-health__actions');
                  if (actions) actions.remove();
                }
                Utils.showToast('Protezione locale attivata su questo dispositivo', 'success');
              } else {
                if (status) {
                  status.textContent =
                    'Il browser non ha concesso la protezione avanzata. Mantieni aggiornato il Backup JSON.';
                }
                Utils.showToast(
                  'Protezione non concessa dal browser: il backup resta la tutela principale',
                  'warning'
                );
              }
            })
            .catch(function (error) {
              console.error('Richiesta di protezione locale non riuscita:', error);
              Utils.showToast('Impossibile richiedere la protezione locale', 'error');
            })
            .finally(function () {
              if (actionEl.isConnected) {
                actionEl.disabled = false;
                actionEl.removeAttribute('aria-busy');
              }
            });
          break;
        }

        /* ── Modal ── */
        case 'modal-cancel': {
          Views.hideModal();
          break;
        }
        case 'modal-confirm': {
          var onConfirm = modalOverlay._onConfirm;
          if (typeof onConfirm === 'function') {
            onConfirm();
          }
          break;
        }

        default:
          break;
      }
    });

    // Dark mode toggle via checkbox change event
    document.addEventListener('change', function (e) {
      if (e.target.closest('[data-action="toggle-dark"]') || (e.target.type === 'checkbox' && e.target.closest('.toggle-switch') && e.target.getAttribute('data-action') === 'toggle-dark')) {
        Theme.toggleDarkMode();
      }
    });

    // Form submission
    document.addEventListener('submit', function (e) {
      if (e.target.id === 'recipe-form') {
        e.preventDefault();
        saveRecipe();
      }
    });

    // PWA Custom Install Prompt setup
    setupInstallPrompt();
  }

  /* ──────────────────── PWA INSTALL PROMPT ──────────────────── */

  function setupInstallPrompt() {
    var isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) {
      return; // App già installata ed in esecuzione
    }

    var deferredPrompt;
    var installPrompt = document.getElementById('install-prompt');
    var btnInstallConfirm = document.getElementById('btn-install-confirm');
    var btnInstallCancel = document.getElementById('btn-install-cancel');

    // Intercetta l'evento di installazione standard (Android/Chrome/Edge/Windows)
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      
      var dismissedTime = safeStorageGet('sapori-install-dismissed');
      var now = Date.now();
      
      // Mostra il prompt se non è stato rifiutato di recente (negli ultimi 7 giorni)
      if (!dismissedTime || (now - parseInt(dismissedTime, 10)) > 7 * 24 * 60 * 60 * 1000) {
        if (installPrompt) {
          installPrompt.classList.remove('hidden');
        }
      }
    });

    // Rileva quando l'app viene installata con successo
    window.addEventListener('appinstalled', function (e) {
      console.log('Sapori installata con successo.');
      if (installPrompt) {
        installPrompt.classList.add('hidden');
      }
      deferredPrompt = null;
    });

    // Gestione installazione su iOS Safari (Aggiungi alla Home manuale)
    var isModernIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    var isIOS = (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      isModernIPad
    ) && !window.MSStream;

    if (isIOS) {
      var dismissedTime = safeStorageGet('sapori-install-dismissed');
      var now = Date.now();
      if (!dismissedTime || (now - parseInt(dismissedTime, 10)) > 7 * 24 * 60 * 60 * 1000) {
        var promptTitle = document.querySelector('.install-prompt__title');
        var promptDesc = document.querySelector('.install-prompt__description');
        var promptConfirm = document.getElementById('btn-install-confirm');
        
        if (promptTitle) promptTitle.textContent = "Installa Sapori su iPhone";
        if (promptDesc) promptDesc.innerHTML = 'Tocca il tasto <strong>Condivisione</strong> <span style="font-size:1.1rem;" aria-hidden="true">⎋</span> in Safari e seleziona <strong>&quot;Aggiungi alla schermata Home&quot;</strong>.';
        
        if (promptConfirm) promptConfirm.style.display = 'none';
        if (btnInstallCancel) btnInstallCancel.textContent = "Ho capito";
        
        if (installPrompt) {
          installPrompt.classList.remove('hidden');
        }
      }
    }

    if (btnInstallConfirm) {
      btnInstallConfirm.addEventListener('click', function () {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function (choiceResult) {
          if (choiceResult.outcome === 'accepted') {
            console.log('Installazione accettata');
          } else {
            console.log('Installazione rifiutata');
          }
          deferredPrompt = null;
          if (installPrompt) {
            installPrompt.classList.add('hidden');
          }
        });
      });
    }

    if (btnInstallCancel) {
      btnInstallCancel.addEventListener('click', function () {
        if (installPrompt) {
          installPrompt.classList.add('hidden');
        }
        safeStorageSet('sapori-install-dismissed', Date.now().toString());
      });
    }
  }

  /* ──────────────────── DATA LOSS WARNING MODAL ──────────────────── */

  function setupDataWarning() {
    var warningModal = document.getElementById('warning-modal');
    var btnClose = document.getElementById('btn-warning-close');
    var btnDontShow = document.getElementById('btn-warning-dontshow');

    if (!warningModal) return;

    var previousFocus = null;
    var backgroundNodes = [appContent, document.getElementById('app-header'), bottomNav, searchBar].filter(Boolean);

    function setWarningOpen(open) {
      warningModal.classList.toggle('hidden', !open);
      warningModal.setAttribute('aria-hidden', open ? 'false' : 'true');
      backgroundNodes.forEach(function (node) { node.inert = open; });
      if (open) {
        previousFocus = document.activeElement;
        if (btnClose) btnClose.focus();
      } else if (previousFocus && previousFocus.isConnected) {
        previousFocus.focus();
      }
    }

    var dismissed = safeStorageGet('sapori-warning-dismissed');
    if (dismissed !== 'true') {
      setWarningOpen(true);
    }

    if (btnClose) {
      btnClose.addEventListener('click', function () {
        setWarningOpen(false);
      });
    }

    if (btnDontShow) {
      btnDontShow.addEventListener('click', function () {
        safeStorageSet('sapori-warning-dismissed', 'true');
        setWarningOpen(false);
      });
    }

    warningModal.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setWarningOpen(false);
      } else if (event.key === 'Tab' && btnClose && btnDontShow) {
        if (event.shiftKey && document.activeElement === btnDontShow) {
          event.preventDefault();
          btnClose.focus();
        } else if (!event.shiftKey && document.activeElement === btnClose) {
          event.preventDefault();
          btnDontShow.focus();
        }
      }
    });
  }

  /* ──────────────────── SERVICE WORKER ──────────────────── */

  var pendingServiceWorker = null;
  var promptedServiceWorker = null;
  var updateReloadRequested = false;
  var updatePromptTimer = null;

  function offerServiceWorkerUpdate(worker) {
    if (!worker || promptedServiceWorker === worker) return;
    pendingServiceWorker = worker;

    if (updatePromptTimer !== null) return;
    updatePromptTimer = window.setTimeout(function tryToShowUpdate() {
      updatePromptTimer = null;
      if (!pendingServiceWorker) return;

      if (modalOverlay && !modalOverlay.classList.contains('hidden')) {
        updatePromptTimer = window.setTimeout(tryToShowUpdate, 1000);
        return;
      }

      var workerToActivate = pendingServiceWorker;
      pendingServiceWorker = null;
      promptedServiceWorker = workerToActivate;
      Views.showConfirmModal(
        'Aggiornamento disponibile',
        'È pronta una nuova versione di Sapori. Aggiorna ora per usare le ultime correzioni.',
        function () {
          updateReloadRequested = true;
          Views.hideModal();
          workerToActivate.postMessage({ type: 'SKIP_WAITING' });
        },
        {
          cancelLabel: 'Più tardi',
          confirmLabel: 'Aggiorna ora',
          confirmClass: 'btn--primary'
        }
      );
    }, 0);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!updateReloadRequested) return;
      updateReloadRequested = false;
      window.location.reload();
    });

    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(function (reg) {
        console.log('Service Worker registrato con successo', reg.scope);

        if (reg.waiting && navigator.serviceWorker.controller) {
          offerServiceWorkerUpdate(reg.waiting);
        }

        reg.addEventListener('updatefound', function () {
          var installingWorker = reg.installing;
          if (!installingWorker) return;

          installingWorker.addEventListener('statechange', function () {
            if (
              installingWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              offerServiceWorkerUpdate(installingWorker);
            }
          });
        });

        reg.update().catch(function () {
          // Il controllo automatico del browser riproverà al prossimo avvio.
        });
      })
      .catch(function (err) {
        console.error('Registrazione Service Worker fallita:', err);
      });
  }

  /* ──────────────────── BOOT ──────────────────── */

  init().catch(function (err) {
    console.error('Errore inizializzazione app:', err);
    appContent.innerHTML =
      '<div class="view empty-state" role="alert">' +
        '<h1>Impossibile avviare Sapori</h1>' +
        '<p>I dati locali non sono accessibili in questo momento. Chiudi eventuali altre schede di Sapori e riprova.</p>' +
        '<button type="button" class="btn btn--primary" id="btn-retry-init">Riprova</button>' +
      '</div>';
    var retryButton = document.getElementById('btn-retry-init');
    if (retryButton) retryButton.addEventListener('click', function () {
      window.location.reload();
    });
  });

})();
