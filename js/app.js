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
    routeToken: 0,
    lastStableHash: '#home',
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
      timer.minutes = Math.min(99, Math.max(0, parseInt(minEl.value, 10) || 0));
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
    Views.hideModal();
  }

  function rerenderCookingModal() {
    if (state.cooking && state.cooking.recipe) {
      var focusedAction = document.activeElement && document.activeElement.getAttribute
        ? document.activeElement.getAttribute('data-action')
        : null;
      Views.showCookingModal(
        state.cooking.recipe,
        state.cooking.stepIndex,
        state.cooking.checkedIngredients,
        !!(state.cooking.wakeLockSentinel && !state.cooking.wakeLockSentinel.released),
        state.cooking.timer,
        state.cooking.ingExpanded
      );
      if (focusedAction) {
        var replacement = document.querySelector('[data-action="' + focusedAction + '"]');
        if (replacement) replacement.focus();
      }
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
    await requestPersistentStorage();
    await loadCustomCategories();
    await Theme.init();
    setupRouter();
    setupEventListeners();
    setupModalAccessibility();
    setupDataWarning();
    navigateTo(window.location.hash || '#home');
    registerServiceWorker();
  }

  async function loadCustomCategories() {
    try {
      var categoriesSetting = await DB.getSetting('customCategories');
      if (categoriesSetting) {
        var custom = JSON.parse(categoriesSetting);
        if (Array.isArray(custom)) {
          // Rimuovi eventuali custom categories caricate in precedenza (evita duplicati)
          Recipes.CATEGORIES = Recipes.CATEGORIES.filter(function (cat) {
            return !cat.isCustom;
          });
          // Unisci le categorie personalizzate caricate
          custom.forEach(function (cat) {
            cat.isCustom = true;
            Recipes.CATEGORIES.push(cat);
          });
        }
      }
    } catch (e) {
      console.warn('Errore nel caricamento delle categorie personalizzate:', e);
    }
  }

  async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
      try {
        var isPersisted = await navigator.storage.persisted();
        console.log('Stato persistenza iniziale:', isPersisted);
        
        if (!isPersisted) {
          var granted = await navigator.storage.persist();
          console.log('Persistenza storage richiesta. Risultato:', granted);
          if (granted) {
            console.log('Il browser ha concesso lo storage persistente.');
          } else {
            console.warn('Il browser ha rifiutato lo storage persistente.');
          }
        } else {
          console.log('Lo storage è già persistente.');
        }
      } catch (e) {
        console.warn('Errore durante la richiesta di storage persistente:', e);
      }
    }
  }

  async function saveCustomCategory(newCat) {
    if (state.savingCategory) return;
    state.savingCategory = true;
    try {
      var categoriesSetting = await DB.getSetting('customCategories');
      var custom = [];
      if (categoriesSetting) {
        custom = JSON.parse(categoriesSetting);
      }
      
      custom.push(newCat);
      await DB.setSetting('customCategories', JSON.stringify(custom));
      
      // Aggiorna array in esecuzione
      Recipes.CATEGORIES.push(newCat);
      
      Utils.showToast('Categoria aggiunta! 🏷️', 'success');
      
      // Re-render delle impostazioni
      if (state.currentView === 'settings') {
        Views.renderSettings(appContent);
      }
    } catch (e) {
      Utils.showToast('Errore durante il salvataggio della categoria', 'error');
    } finally {
      state.savingCategory = false;
    }
  }

  async function deleteCustomCategory(catId) {
    try {
      var movedRecipes = await DB.reassignCategory(catId, 'altro');
      var categoriesSetting = await DB.getSetting('customCategories');
      if (categoriesSetting) {
        var custom = JSON.parse(categoriesSetting);
        custom = custom.filter(function (cat) {
          return cat.id !== catId;
        });
        
        await DB.setSetting('customCategories', JSON.stringify(custom));
        
        // Aggiorna array in esecuzione
        Recipes.CATEGORIES = Recipes.CATEGORIES.filter(function (cat) {
          return cat.id !== catId;
        });
        
        Utils.showToast(
          movedRecipes > 0
            ? 'Categoria eliminata: ' + movedRecipes + ' ricett' + (movedRecipes === 1 ? 'a spostata' : 'e spostate') + ' in Altro.'
            : 'Categoria eliminata',
          'success'
        );
        
        // Re-render delle impostazioni
        if (state.currentView === 'settings') {
          Views.renderSettings(appContent);
        }
      }
    } catch (e) {
      Utils.showToast('Errore durante l\'eliminazione della categoria', 'error');
    }
  }

  /* ──────────────────── HASH-BASED ROUTER ──────────────────── */

  function setupRouter() {
    window.addEventListener('hashchange', function () {
      var hash = window.location.hash || '#home';
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

  async function renderRouteView(token, renderer) {
    var staging = document.createElement('div');
    await renderer(staging);
    if (token !== state.routeToken) return false;
    appContent.innerHTML = staging.innerHTML;
    return true;
  }

  async function handleRoute(hash) {
    var token = ++state.routeToken;
    // Parse the hash
    var parts = hash.replace('#', '').split('/');
    var view = parts[0] || 'home';
    var param = parts[1] || null;

    state.currentView = view;
    closeSearch(false);

    // Transition animation
    appContent.classList.add('animate-fade-in');
    setTimeout(function () { appContent.classList.remove('animate-fade-in'); }, 400);

    switch (view) {
      case 'home':
        updateNav('home');
        showHeader(true);
        appContent.innerHTML = '<div class="view" role="status">Caricamento ricette…</div>';
        await renderRouteView(token, function (container) {
          return Views.renderHome(container, state.filters);
        });
        break;

      case 'create':
        updateNav('create');
        showHeader(false);
        state.editingRecipe = null;
        if (token !== state.routeToken) return;
        Views.renderCreate(appContent, null);
        break;

      case 'edit':
        updateNav('create');
        showHeader(false);
        if (param) {
          appContent.innerHTML = '<div class="view" role="status">Caricamento ricetta…</div>';
          var recipe = await DB.getRecipe(param);
          if (token !== state.routeToken) return;
          if (recipe) {
            state.editingRecipe = recipe;
            Views.renderCreate(appContent, recipe);
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
        showHeader(false);
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
        showHeader(true);
        appContent.innerHTML = '<div class="view" role="status">Caricamento preferiti…</div>';
        await renderRouteView(token, function (container) {
          return Views.renderFavorites(container);
        });
        break;

      case 'settings':
        updateNav('settings');
        showHeader(true);
        appContent.innerHTML = '<div class="view" role="status">Caricamento impostazioni…</div>';
        await renderRouteView(token, function (container) {
          return Views.renderSettings(container);
        });
        break;

      case 'pantry':
        updateNav('');
        showHeader(false);
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
  }

  function hasUnsavedForm() {
    return (state.currentView === 'create' || state.currentView === 'edit') &&
      !!document.getElementById('recipe-form') &&
      isFormDirty();
  }

  function confirmUnsavedNavigation(hash) {
    Views.showConfirmModal(
      'Modifiche non salvate',
      'Uscendo da questa pagina perderai le modifiche non salvate. Vuoi continuare?',
      function () {
        Views.hideModal();
        navigateTo(hash, true);
      }
    );
  }

  function navigateTo(hash, force) {
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

  function showHeader(visible) {
    var header = document.getElementById('app-header');
    if (visible) {
      header.classList.remove('hidden');
      bottomNav.classList.remove('hidden');
    } else {
      header.classList.add('hidden');
      bottomNav.classList.add('hidden');
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
    searchBar.classList.remove('hidden');
    document.body.classList.add('search-open');
    btnSearchToggle.setAttribute('aria-expanded', 'true');
    searchInput.focus();
  }

  function closeSearch(shouldRender) {
    if (shouldRender === undefined) shouldRender = true;
    searchBar.classList.add('hidden');
    document.body.classList.remove('search-open');
    btnSearchToggle.setAttribute('aria-expanded', 'false');
    searchInput.value = '';
    if (state.filters.search !== '') {
      state.filters.search = '';
      if (shouldRender && state.currentView === 'home') {
        Views.renderHome(appContent, state.filters);
      }
    }
  }

  var debouncedSearch = Utils.debounce(function (value) {
    state.filters.search = value;
    if (state.currentView === 'home') {
      Views.renderHome(appContent, state.filters);
    }
  }, 300);

  /* ──────────────────── FAVORITE TOGGLE ──────────────────── */

  async function toggleFavorite(id) {
    try {
      var recipe = await DB.getRecipe(id);
      if (!recipe) return;
      recipe.isFavorite = !recipe.isFavorite;
      recipe.updatedAt = Date.now();
      await DB.updateRecipe(recipe);
      Utils.showToast(
        recipe.isFavorite ? 'Aggiunta ai preferiti ❤️' : 'Rimossa dai preferiti',
        'success'
      );
      return recipe.isFavorite;
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
    var name = document.getElementById('input-name').value.trim();
    var category = document.getElementById('input-category').value;
    var description = (document.getElementById('input-description').value || '').trim();
    var notes = (document.getElementById('input-notes').value || '').trim();
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
      ingredients: ingredients,
      steps: steps,
      prepTime: prepTime,
      cookTime: cookTime,
      difficulty: difficulty,
      servings: servings,
      image: imageData || null,
      imageThumbnail: imageThumbnailData || null,
      isFavorite: state.editingRecipe ? state.editingRecipe.isFavorite : false,
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
  }

  function switchFormTab(targetId) {
    var tabs = document.querySelectorAll('.form-tab');
    var navBtns = document.querySelectorAll('.form-steps-btn');
    
    tabs.forEach(function (tab) {
      if (tab.id === targetId) {
        tab.classList.add('active');
        tab.setAttribute('aria-hidden', 'false');
      } else {
        tab.classList.remove('active');
        tab.setAttribute('aria-hidden', 'true');
      }
    });

    navBtns.forEach(function (btn) {
      if (btn.getAttribute('data-target') === targetId) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      }
    });
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
    name: { spanId: 'error-name', tab: 'tab-info' },
    category: { spanId: 'error-category', tab: 'tab-info' },
    description: { spanId: 'error-description', tab: 'tab-info' },
    notes: { spanId: 'error-notes', tab: 'tab-info' },
    prepTime: { spanId: 'error-preptime', tab: 'tab-cook' },
    cookTime: { spanId: 'error-cooktime', tab: 'tab-cook' },
    servings: { spanId: 'error-servings', tab: 'tab-cook' },
    difficulty: { spanId: 'error-difficulty', tab: 'tab-cook' },
    ingredients: { spanId: 'error-ingredients', tab: 'tab-prep' },
    steps: { spanId: 'error-steps', tab: 'tab-prep' }
  };
  // Priorità di apertura tab quando ci sono errori su più tab insieme:
  // Info > Preparazione > Cottura (si apre sempre la tab più "a monte").
  var TAB_OPEN_PRIORITY = { 'tab-info': 0, 'tab-prep': 1, 'tab-cook': 2 };

  function showFormErrors(errors) {
    var switchTarget = null;

    // errors è un oggetto { fieldName: "messaggio" }; fieldName può essere un nome
    // fisso (name, category, prepTime...) oppure "ingredient_0", "step_2", ecc.
    Object.keys(errors).forEach(function (key) {
      var message = errors[key];
      if (!message) return;

      var mapping = FIELD_ERROR_MAP[key];
      if (!mapping) {
        if (key.indexOf('ingredient_') === 0) {
          mapping = FIELD_ERROR_MAP.ingredients;
        } else if (key.indexOf('step_') === 0) {
          mapping = FIELD_ERROR_MAP.steps;
        }
      }
      if (!mapping) return; // chiave senza slot dedicato (es. _general): nessun posto dove mostrarla

      setFieldError(mapping.spanId, message);

      if (switchTarget === null || TAB_OPEN_PRIORITY[mapping.tab] < TAB_OPEN_PRIORITY[switchTarget]) {
        switchTarget = mapping.tab;
      }
    });

    if (switchTarget) {
      switchFormTab(switchTarget);
    }
  }

  function setFieldError(errorId, message) {
    var el = document.getElementById(errorId);
    if (!el) return;
    el.textContent = message;
    var group = el.closest('.form-group');
    if (group) group.classList.add('has-error');
  }

  /* ──────────────────── FORM: SAVE ──────────────────── */

  async function saveRecipe() {
    if (state.savingRecipe) return;
    clearFormErrors();
    var recipe = collectFormData();
    var validation = Recipes.validate(recipe);

    if (!validation.valid) {
      showFormErrors(validation.errors);
      Utils.showToast('Correggi gli errori nel modulo', 'error');
      return;
    }

    var submitButton = document.querySelector('#recipe-form button[type="submit"]');
    state.savingRecipe = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
    }

    try {
      if (state.editingRecipe) {
        await DB.updateRecipe(recipe);
        Utils.showToast('Ricetta aggiornata con successo! ✅', 'success');
      } else {
        await DB.addRecipe(recipe);
        Utils.showToast('Ricetta creata con successo! 🎉', 'success');
      }
      navigateTo('#home', true);
    } catch (e) {
      Utils.showToast('Errore nel salvataggio: ' + e.message, 'error');
    } finally {
      state.savingRecipe = false;
      if (submitButton && submitButton.isConnected) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
      }
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
  }

  /* ──────────────────── IMAGE HANDLING ──────────────────── */

  var imageRequestToken = 0;

  function triggerImageUpload() {
    var fileInput = document.getElementById('input-image');
    if (fileInput) fileInput.click();
  }

  async function handleImageFile(file) {
    var fileInput = document.getElementById('input-image');
    if (!file) return;
    if (!Utils.ALLOWED_IMAGE_TYPES.includes(String(file.type || '').toLowerCase())) {
      if (fileInput) fileInput.value = '';
      Utils.showToast('Formato non supportato. Usa JPEG, PNG o WebP', 'error');
      return;
    }
    if (file.size > Utils.MAX_IMAGE_FILE_BYTES) {
      if (fileInput) fileInput.value = '';
      Utils.showToast('La foto supera il limite di 12 MB', 'error');
      return;
    }

    var requestToken = ++imageRequestToken;
    var uploadArea = document.getElementById('image-upload-area');
    if (uploadArea) uploadArea.setAttribute('aria-busy', 'true');
    try {
      var base64 = await Utils.compressImage(file, 1280);
      var thumbnail = await Utils.createImageThumbnail(base64, 360);
      if (requestToken !== imageRequestToken) return;
      document.getElementById('input-image-data').value = base64;
      document.getElementById('input-image-thumbnail-data').value = thumbnail;

      uploadArea.innerHTML =
        '<div class="image-upload__preview">' +
          '<button type="button" class="image-upload__change" data-action="trigger-image-upload" aria-label="Cambia foto">' +
            '<img src="' + Utils.escapeHtml(base64) + '" alt="Anteprima" id="image-preview">' +
          '</button>' +
          '<button type="button" class="image-upload__remove" data-action="remove-image" aria-label="Rimuovi foto">✕</button>' +
        '</div>';
    } catch (e) {
      if (requestToken === imageRequestToken) {
        Utils.showToast(e && e.message ? e.message : 'Errore nel caricamento dell’immagine', 'error');
      }
    } finally {
      if (requestToken === imageRequestToken && uploadArea) {
        uploadArea.removeAttribute('aria-busy');
      }
      if (fileInput) fileInput.value = '';
    }
  }

  function removeImage() {
    imageRequestToken += 1;
    document.getElementById('input-image-data').value = '';
    document.getElementById('input-image-thumbnail-data').value = '';
    var fileInput = document.getElementById('input-image');
    if (fileInput) fileInput.value = '';

    var uploadArea = document.getElementById('image-upload-area');
    uploadArea.innerHTML =
      '<button type="button" class="image-upload__placeholder" id="image-placeholder" data-action="trigger-image-upload">' +
        '<span style="font-size:2rem">📷</span>' +
        '<span>Tocca per aggiungere una foto</span>' +
      '</button>';
  }

  /* ──────────────────── EXPORT / IMPORT ──────────────────── */

  async function exportData() {
    try {
      var json = await DB.exportData();
      var date = new Date().toISOString().slice(0, 10);
      Utils.triggerDownload(json, 'sapori-backup-' + date + '.json', 'application/json');
      Utils.showToast('Esportazione completata! 📥', 'success');
    } catch (e) {
      Utils.showToast('Errore nell\'esportazione', 'error');
    }
  }

  async function exportAllRecipesPDF() {
    try {
      var recipes = await DB.getAllRecipes();
      if (!recipes || recipes.length === 0) {
        Utils.showToast('Nessuna ricetta da esportare! 🍳', 'error');
        return;
      }

      Utils.showToast('Preparazione ricettario in corso… 📚', 'info');

      // Sort A-Z
      recipes.sort(function (a, b) { return a.name.localeCompare(b.name, 'it-IT'); });

      var esc = Utils.escapeHtml;
      var today = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
      var pwaUrl = window.location.origin + window.location.pathname;

      var printDiv = document.createElement('div');
      printDiv.className = 'print-document-root print-document-root--cookbook print-all-recipes-container';

      var html = '';

      // ── COVER PAGE ──
      html +=
        '<div class="print-cover-page">' +
          '<div class="print-cover-brand">🍴 SAPORI</div>' +
          '<div class="print-cover-emoji">📖</div>' +
          '<div class="print-cover-title">Il Mio Ricettario</div>' +
          '<div class="print-cover-divider"></div>' +
          '<div class="print-cover-subtitle">' + recipes.length + ' ricette della tradizione di casa</div>' +
          '<div class="print-cover-meta">' +
            '<span>Esportato il ' + today + '</span>' +
            '<span>' + esc(pwaUrl) + '</span>' +
          '</div>' +
        '</div>';

      // ── INDEX PAGE ──
      html += '<div class="print-index-page">';
      html += '<div class="print-index-title">Indice delle Ricette</div>';
      html += '<ul class="print-index-list">';
      recipes.forEach(function (recipe) {
        var cat = Utils.getCategoryInfo(recipe.category);
        html +=
          '<li class="print-index-item">' +
            '<span class="print-index-item-name">' + esc(cat.icon) + ' ' + esc(recipe.name) + '</span>' +
            '<span class="print-index-item-cat">' + esc(cat.label) + '</span>' +
          '</li>';
      });
      html += '</ul>';
      html += '</div>';

      // ── RECIPES ──
      recipes.forEach(function (recipe) {
        var cat = Utils.getCategoryInfo(recipe.category);
        var diffEmoji = Utils.getDifficultyEmoji(recipe.difficulty);
        var diffMap = { facile: 'Facile', media: 'Media', difficile: 'Difficile' };

        html += '<article class="print-cookbook-recipe">';

        // Title
        html += '<h1 class="recipe-detail__title">' + esc(recipe.name) + '</h1>';

        // Category
        html +=
          '<span class="recipe-card__category" style="border-color:' + esc(cat.color) + ';color:' + esc(cat.color) + '">' +
            esc(cat.icon) + ' ' + esc(cat.label) +
          '</span>';

        // Info bar
        html +=
          '<div class="recipe-detail__info-bar">' +
            '<div class="recipe-detail__info-item"><span>Preparazione:</span><span>' + esc(Utils.formatTime(recipe.prepTime || 0)) + '</span></div>' +
            '<div class="recipe-detail__info-item"><span>Cottura:</span><span>' + esc(Utils.formatTime(recipe.cookTime || 0)) + '</span></div>' +
            '<div class="recipe-detail__info-item"><span>Porzioni:</span><span>' + (recipe.servings || 4) + '</span></div>' +
            '<div class="recipe-detail__info-item"><span>Difficolt\u00e0:</span><span>' + esc(diffEmoji) + ' ' + esc(diffMap[recipe.difficulty] || 'Facile') + '</span></div>' +
          '</div>';

        // Description
        if (recipe.description) {
          html +=
            '<div class="recipe-detail__section recipe-detail__description-section">' +
              '<h3 class="recipe-detail__description-title">Descrizione</h3>' +
              '<p>' + esc(recipe.description) + '</p>' +
            '</div>';
        }

        // Notes
        html +=
          '<div class="recipe-detail__section recipe-detail__notes-section">' +
            '<h3 class="recipe-detail__notes-title">Note</h3>' +
            (recipe.notes
              ? '<p>' + esc(recipe.notes) + '</p>'
              : '<div class="print-dotted-line"></div><div class="print-dotted-line"></div><div class="print-dotted-line"></div>') +
          '</div>';

        // Body
        html += '<div class="recipe-detail__body-layout">';

        // Ingredients
        html +=
          '<div class="recipe-detail__section recipe-detail__ingredients-section">' +
            '<h2 class="recipe-detail__section-title">Ingredienti</h2>' +
            '<ul class="ingredient-list">';
        if (recipe.ingredients && recipe.ingredients.length > 0) {
          recipe.ingredients.forEach(function (ing) {
            var qtyStr = ing.quantity ? esc(ing.quantity) + (ing.unit ? ' ' + esc(ing.unit) : '') : '';
            var qtyPart = qtyStr ? '<span class="ingredient-item__qty">' + qtyStr + '</span>' : '';
            var namePart = '<span class="ingredient-item__name">' + esc(ing.name) + '</span>';
            var notesHTML = ing.notes ? '<span class="ingredient-item__notes">💡 ' + esc(ing.notes) + '</span>' : '';

            html +=
              '<li class="ingredient-item">' +
                '<span class="ingredient-bullet">•</span>' +
                '<div class="ingredient-item__body">' +
                  '<div class="ingredient-item__main">' +
                    namePart + (qtyPart ? ' ' + qtyPart : '') +
                  '</div>' +
                  notesHTML +
                '</div>' +
              '</li>';
          });
        }
        html += '</ul></div>';

        // Steps
        html +=
          '<div class="recipe-detail__section recipe-detail__steps-section">' +
            '<h2 class="recipe-detail__section-title">Preparazione</h2>' +
            '<ol class="step-list">';
        if (recipe.steps && recipe.steps.length > 0) {
          recipe.steps.forEach(function (stepVal, idx) {
            var stepText = typeof stepVal === 'object' ? stepVal.text : stepVal;
            var stepNotes = typeof stepVal === 'object' ? stepVal.notes : '';
            var notesHtml = stepNotes ? '<span class="step-item__notes">💡 ' + esc(stepNotes) + '</span>' : '';
            html +=
              '<li class="step-item">' +
                '<span class="step-number">' + (idx + 1) + '</span>' +
                '<div class="step-content">' +
                  '<p>' + esc(stepText) + '</p>' +
                  notesHtml +
                '</div>' +
              '</li>';
          });
        }
        html += '</ol></div>';

        html += '</div>'; // body-layout

        // Footer: photo + storage
        html +=
          '<div class="print-footer-container">' +
            '<div class="print-photo-box">' +
              (recipe.image ? '<img src="' + esc(recipe.image) + '" alt="Foto">' : '<span class="print-photo-label">FOTO</span>') +
            '</div>' +
            '<div class="print-storage-box">' +
              '<h4 class="print-storage-title">Conservazione:</h4>' +
              '<div class="print-dotted-line"></div>' +
              '<div class="print-dotted-line"></div>' +
              '<div class="print-dotted-line"></div>' +
            '</div>' +
          '</div>';

        html += '</article>';
      });

      printDiv.innerHTML = html;
      document.body.appendChild(printDiv);
      await Utils.printDocument(printDiv, 'printing-all-recipes');

    } catch (err) {
      console.error(err);
      Utils.showToast('Errore durante la creazione del PDF', 'error');
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
          if (summary.rejected) parts.push(summary.rejected + ' non valide');
          Utils.showToast('Importazione completata: ' + (parts.join(', ') || 'nessuna modifica') + '.', 'success');
          if (state.currentView === 'settings') Views.renderSettings(appContent);
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
        closeSearch();
      }
    });

    // Search close
    btnSearchClose.addEventListener('click', closeSearch);

    // Search input
    searchInput.addEventListener('input', function (e) {
      debouncedSearch(e.target.value.trim());
    });

    // Escape key closes search
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSearch();
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
      if (radio && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        var radios = Array.from(document.querySelectorAll('.category-select-btn'));
        var radioIndex = radios.indexOf(radio);
        var direction = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        var nextRadio = radios[(radioIndex + direction + radios.length) % radios.length];
        e.preventDefault();
        nextRadio.focus();
        nextRadio.click();
      }
    });

    // File input for image
    document.addEventListener('change', function (e) {
      if (e.target.id === 'input-image') {
        var file = e.target.files && e.target.files[0];
        if (file) handleImageFile(file);
      }
      if (e.target.id === 'import-file-input') {
        var importFile = e.target.files && e.target.files[0];
        if (importFile) handleImportFile(importFile);
      }
      // Sort select
      if (e.target.id === 'sort-select') {
        state.filters.sortBy = e.target.value;
        if (state.currentView === 'home') {
          Views.renderHome(appContent, state.filters);
        }
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
          Views.renderPantry(appContent, state.pantryIngredients);
          input.value = '';
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
          var id = actionEl.getAttribute('data-id');
          if (id) navigateTo('#detail/' + id);
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
            Views.renderPantry(appContent, state.pantryIngredients);
          }
          break;
        }
        case 'remove-pantry-ingredient': {
          var pIdx = parseInt(actionEl.getAttribute('data-index'), 10);
          if (!isNaN(pIdx) && pIdx >= 0 && pIdx < state.pantryIngredients.length) {
            state.pantryIngredients.splice(pIdx, 1);
            Views.renderPantry(appContent, state.pantryIngredients);
          }
          break;
        }
        case 'clear-pantry': {
          state.pantryIngredients = [];
          Views.renderPantry(appContent, state.pantryIngredients);
          break;
        }
        case 'go-back': {
          navigateTo('#home');
          break;
        }
        case 'edit-recipe': {
          var editId = actionEl.getAttribute('data-id');
          if (editId) navigateTo('#edit/' + editId);
          break;
        }
        case 'export-pdf': {
          var pdfId = actionEl.getAttribute('data-id');
          if (pdfId) {
            DB.getRecipe(pdfId).then(function (recipe) {
              if (recipe && window.Views) {
                Views.showPrintPreviewModal(recipe);
              }
            });
          } else {
            // Fallback: print current page
            window.print();
          }
          break;
        }
        case 'share-recipe': {
          var shareId = actionEl.getAttribute('data-id');
          if (shareId) {
            DB.getRecipe(shareId).then(function (recipe) {
              if (recipe && window.Share) {
                window.Share.openShareMenu(recipe);
              }
            });
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
                Views.renderHome(appContent, state.filters);
              } else if (state.currentView === 'favorites') {
                Views.renderFavorites(appContent);
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
          Views.renderHome(appContent, state.filters);
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
            });
          }
          actionEl.classList.add('active');
          actionEl.setAttribute('aria-checked', 'true');
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
          if (nextId) switchFormTab(nextId);
          break;
        }
        case 'prev-tab': {
          var prevId = actionEl.getAttribute('data-prev');
          if (prevId) switchFormTab(prevId);
          break;
        }
        case 'switch-tab': {
          var targetId = actionEl.getAttribute('data-target');
          if (targetId) switchFormTab(targetId);
          break;
        }

        /* ── Form: cancel ── */
        case 'cancel-form': {
          var performNavigate = function () {
            if (state.editingRecipe) {
              navigateTo('#detail/' + state.editingRecipe.id);
            } else {
              navigateTo('#home');
            }
          };

          if (isFormDirty()) {
            Views.showConfirmModal(
              'Uscire dal modulo?',
              'Sei sicuro di voler uscire? Le modifiche non salvate andranno perse.',
              function () {
                Views.hideModal();
                if (state.editingRecipe) {
                  navigateTo('#detail/' + state.editingRecipe.id, true);
                } else {
                  navigateTo('#home', true);
                }
              }
            );
          } else {
            performNavigate();
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
              Views.renderSettings(appContent);
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
          exportAllRecipesPDF();
          break;
        }
        case 'export-data': {
          exportData();
          break;
        }
        case 'import-data': {
          importData();
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
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

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
