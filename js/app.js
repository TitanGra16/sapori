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
    editingRecipe: null
  };

  /* ──────────────────── DOM REFERENCES ──────────────────── */

  var appContent = document.getElementById('app-content');
  var bottomNav = document.getElementById('bottom-nav');
  var searchBar = document.getElementById('search-bar');
  var searchInput = document.getElementById('search-input');
  var btnSearchToggle = document.getElementById('btn-search-toggle');
  var btnSearchClose = document.getElementById('btn-search-close');
  var btnThemeToggle = document.getElementById('btn-theme-toggle');
  var modalOverlay = document.getElementById('modal-overlay');

  /* ──────────────────── INITIALIZATION ──────────────────── */

  async function init() {
    await DB.init();
    await requestPersistentStorage();
    await loadCustomCategories();
    await Theme.init();
    updateThemeIcon();
    setupRouter();
    setupEventListeners();
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
    }
  }

  async function deleteCustomCategory(catId) {
    try {
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
        
        Utils.showToast('Categoria eliminata', 'success');
        
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
      handleRoute(hash);
    });
  }

  function handleRoute(hash) {
    // Parse the hash
    var parts = hash.replace('#', '').split('/');
    var view = parts[0] || 'home';
    var param = parts[1] || null;

    state.currentView = view;

    // Transition animation
    appContent.classList.add('animate-fade-in');
    setTimeout(function () { appContent.classList.remove('animate-fade-in'); }, 400);

    switch (view) {
      case 'home':
        updateNav('home');
        showHeader(true);
        Views.renderHome(appContent, state.filters);
        break;

      case 'create':
        updateNav('create');
        showHeader(false);
        state.editingRecipe = null;
        Views.renderCreate(appContent, null);
        break;

      case 'edit':
        updateNav('create');
        showHeader(false);
        if (param) {
          DB.getRecipe(param).then(function (recipe) {
            if (recipe) {
              state.editingRecipe = recipe;
              Views.renderCreate(appContent, recipe);
            } else {
              Utils.showToast('Ricetta non trovata', 'error');
              navigateTo('#home');
            }
          });
        } else {
          navigateTo('#home');
        }
        break;

      case 'detail':
        updateNav('');
        showHeader(false);
        if (param) {
          Views.renderDetail(appContent, param);
        } else {
          navigateTo('#home');
        }
        break;

      case 'favorites':
        updateNav('favorites');
        showHeader(true);
        Views.renderFavorites(appContent);
        break;

      case 'settings':
        updateNav('settings');
        showHeader(true);
        Views.renderSettings(appContent);
        break;

      default:
        navigateTo('#home');
        break;
    }

    // Close search bar on navigation
    closeSearch();

    // Scroll to top on view change
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function navigateTo(hash) {
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
      } else {
        item.classList.remove('active');
      }
    });
  }

  /* ──────────────────── THEME ICON ──────────────────── */

  function updateThemeIcon() {
    // CSS handles sun/moon visibility via [data-theme] selectors.
    // This function is kept for compatibility but no longer swaps icons.
  }

  /* ──────────────────── SEARCH ──────────────────── */

  function openSearch() {
    searchBar.classList.remove('hidden');
    searchInput.focus();
  }

  function closeSearch() {
    searchBar.classList.add('hidden');
    searchInput.value = '';
    if (state.filters.search !== '') {
      state.filters.search = '';
      if (state.currentView === 'home') {
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
    var idInput = document.getElementById('input-id');
    var name = document.getElementById('input-name').value.trim();
    var category = document.getElementById('input-category').value;
    var description = (document.getElementById('input-description').value || '').trim();
    var imageData = document.getElementById('input-image-data').value || '';
    var prepTime = parseInt(document.getElementById('input-preptime').value, 10) || 0;
    var cookTime = parseInt(document.getElementById('input-cooktime').value, 10) || 0;
    var difficulty = document.getElementById('input-difficulty').value;
    var servings = parseInt(document.getElementById('input-servings').value, 10) || 4;

    // Collect ingredients
    var ingRows = document.querySelectorAll('#ingredients-list .ingredient-row');
    var ingredients = [];
    ingRows.forEach(function (row) {
      var ingName = row.querySelector('[data-field="ing-name"]').value.trim();
      var ingQty = row.querySelector('[data-field="ing-qty"]').value.trim();
      var ingUnit = row.querySelector('[data-field="ing-unit"]').value;
      if (ingName) {
        ingredients.push({ name: ingName, quantity: ingQty, unit: ingUnit });
      }
    });

    // Collect steps
    var stepRows = document.querySelectorAll('#steps-list .step-item');
    var steps = [];
    stepRows.forEach(function (row) {
      var text = row.querySelector('[data-field="step-text"]').value.trim();
      if (text) {
        steps.push(text);
      }
    });

    var now = Date.now();
    var recipe = {
      id: idInput ? idInput.value : Utils.generateId(),
      name: name,
      category: category,
      description: description,
      ingredients: ingredients,
      steps: steps,
      prepTime: prepTime,
      cookTime: cookTime,
      difficulty: difficulty,
      servings: servings,
      image: imageData || null,
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
    var inputs = document.querySelectorAll('.form-input.error, .form-select.error, .form-textarea.error');
    inputs.forEach(function (el) { el.classList.remove('error'); });
  }

  function switchFormTab(targetId) {
    var tabs = document.querySelectorAll('.form-tab');
    var navBtns = document.querySelectorAll('.form-steps-btn');
    
    tabs.forEach(function (tab) {
      if (tab.id === targetId) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    navBtns.forEach(function (btn) {
      if (btn.getAttribute('data-target') === targetId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function isFormDirty() {
    var current = collectFormData();
    var original = state.editingRecipe;

    if (!original) {
      // In creazione: controlla se è stato digitato qualcosa
      if (current.name && current.name.trim() !== '') return true;
      if (current.category && current.category.trim() !== '') return true;
      if (current.description && current.description.trim() !== '') return true;
      if (current.image) return true;
      if (current.prepTime) return true;
      if (current.cookTime) return true;
      if (current.servings && current.servings !== 4 && current.servings !== '') return true;
      
      // Controlla ingredienti
      var ingDirty = current.ingredients.some(function (ing) {
        return (ing.name && ing.name.trim() !== '') || ing.quantity || ing.unit;
      });
      if (ingDirty) return true;

      // Controlla passaggi
      var stepDirty = current.steps.some(function (step) {
        return step && step.trim() !== '';
      });
      if (stepDirty) return true;

      return false;
    } else {
      // In modifica: controlla differenze rispetto alla ricetta originale
      if ((current.name || '') !== (original.name || '')) return true;
      if ((current.category || '') !== (original.category || '')) return true;
      if ((current.description || '') !== (original.description || '')) return true;
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
      }

      // Passaggi
      if (current.steps.length !== original.steps.length) return true;
      for (var j = 0; j < current.steps.length; j++) {
        if ((current.steps[j] || '') !== (original.steps[j] || '')) return true;
      }

      return false;
    }
  }

  function showFormErrors(errors) {
    var switchTarget = null;
    errors.forEach(function (err) {
      if (err.toLowerCase().includes('nome')) {
        setFieldError('error-name', err);
        if (!switchTarget) switchTarget = 'tab-info';
      } else if (err.toLowerCase().includes('categoria')) {
        setFieldError('error-category', err);
        if (!switchTarget) switchTarget = 'tab-info';
      } else if (err.toLowerCase().includes('ingrediente') || err.toLowerCase().includes('ingredienti')) {
        setFieldError('error-ingredients', err);
        if (!switchTarget || switchTarget === 'tab-cook') switchTarget = 'tab-prep';
      } else if (err.toLowerCase().includes('passagg') || err.toLowerCase().includes('preparazione')) {
        setFieldError('error-steps', err);
        if (!switchTarget || switchTarget === 'tab-cook') switchTarget = 'tab-prep';
      }
    });
    if (switchTarget) {
      switchFormTab(switchTarget);
    }
  }

  function setFieldError(errorId, message) {
    var el = document.getElementById(errorId);
    if (el) el.textContent = message;
  }

  /* ──────────────────── FORM: SAVE ──────────────────── */

  async function saveRecipe() {
    clearFormErrors();
    var recipe = collectFormData();
    var validation = Recipes.validate(recipe);

    if (!validation.valid) {
      showFormErrors(validation.errors);
      Utils.showToast('Correggi gli errori nel modulo', 'error');
      return;
    }

    try {
      if (state.editingRecipe) {
        await DB.updateRecipe(recipe);
        Utils.showToast('Ricetta aggiornata con successo! ✅', 'success');
      } else {
        await DB.addRecipe(recipe);
        Utils.showToast('Ricetta creata con successo! 🎉', 'success');
      }
      navigateTo('#home');
    } catch (e) {
      Utils.showToast('Errore nel salvataggio: ' + e.message, 'error');
    }
  }

  /* ──────────────────── FORM: DYNAMIC ROWS ──────────────────── */

  function addIngredientRow() {
    var list = document.getElementById('ingredients-list');
    if (!list) return;
    var rows = list.querySelectorAll('.ingredient-row');
    var newIndex = rows.length;

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
      ingredients.push({
        name: row.querySelector('[data-field="ing-name"]').value,
        quantity: row.querySelector('[data-field="ing-qty"]').value,
        unit: row.querySelector('[data-field="ing-unit"]').value
      });
    });
    return ingredients;
  }

  function rerenderIngredients(ingredients) {
    var list = document.getElementById('ingredients-list');
    if (!list) return;
    var html = '';
    ingredients.forEach(function (ing, idx) {
      html += ingredientRowHTMLFromApp(ing, idx, ingredients.length);
    });
    list.innerHTML = html;
  }

  function ingredientRowHTMLFromApp(ing, index, total) {
    var esc = Utils.escapeHtml;
    var html =
      '<div class="dynamic-list__item ingredient-row" data-index="' + index + '">' +
        '<div class="ingredient-inputs">' +
          '<input type="text" class="form-input" placeholder="Ingrediente" data-field="ing-name" value="' + esc(ing.name || '') + '">' +
          '<input type="text" class="form-input" placeholder="Qtà" data-field="ing-qty" value="' + esc(ing.quantity || '') + '" style="max-width:5rem">' +
          '<select class="form-select" data-field="ing-unit" style="max-width:6rem">' +
            '<option value="">—</option>';
    Recipes.UNITS.forEach(function (u) {
      html += '<option value="' + esc(u) + '"' + (ing.unit === u ? ' selected' : '') + '>' + esc(u) + '</option>';
    });
    html += '</select>';
    if (total > 1) {
      html += '<button type="button" class="btn btn--icon btn--small" data-action="remove-ingredient" data-index="' + index + '" aria-label="Rimuovi">✕</button>';
    }
    html += '</div></div>';
    return html;
  }

  function addStepRow() {
    var steps = collectCurrentSteps();
    steps.push('');
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
      steps.push(row.querySelector('[data-field="step-text"]').value);
    });
    return steps;
  }

  function rerenderSteps(steps) {
    var list = document.getElementById('steps-list');
    if (!list) return;
    var html = '';
    steps.forEach(function (step, idx) {
      html += stepRowHTMLFromApp(step, idx, steps.length);
    });
    list.innerHTML = html;
  }

  function stepRowHTMLFromApp(step, index, total) {
    var esc = Utils.escapeHtml;
    var html =
      '<div class="dynamic-list__item step-item" data-index="' + index + '">' +
        '<span class="step-number">' + (index + 1) + '</span>' +
        '<textarea class="form-textarea" data-field="step-text" rows="2" placeholder="Descrivi il passaggio...">' + esc(step || '') + '</textarea>';
    if (total > 1) {
      html += '<button type="button" class="btn btn--icon btn--small" data-action="remove-step" data-index="' + index + '" aria-label="Rimuovi">✕</button>';
    }
    html += '</div>';
    return html;
  }

  /* ──────────────────── IMAGE HANDLING ──────────────────── */

  function triggerImageUpload() {
    var fileInput = document.getElementById('input-image');
    if (fileInput) fileInput.click();
  }

  async function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;

    try {
      var base64 = await Utils.compressImage(file, 800);
      document.getElementById('input-image-data').value = base64;

      var uploadArea = document.getElementById('image-upload-area');
      uploadArea.innerHTML =
        '<div class="image-upload__preview">' +
          '<img src="' + Utils.escapeHtml(base64) + '" alt="Anteprima" id="image-preview">' +
          '<button type="button" class="image-upload__remove" data-action="remove-image" aria-label="Rimuovi foto">✕</button>' +
        '</div>';
    } catch (e) {
      Utils.showToast('Errore nel caricamento dell\'immagine', 'error');
    }
  }

  function removeImage() {
    document.getElementById('input-image-data').value = '';
    var fileInput = document.getElementById('input-image');
    if (fileInput) fileInput.value = '';

    var uploadArea = document.getElementById('image-upload-area');
    uploadArea.innerHTML =
      '<div class="image-upload__placeholder" id="image-placeholder">' +
        '<span style="font-size:2rem">📷</span>' +
        '<span>Tocca per aggiungere una foto</span>' +
      '</div>';
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

      // Ordina le ricette alfabeticamente A-Z per un ricettario ordinato
      recipes.sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });

      var esc = Utils.escapeHtml;

      // Crea contenitore temporaneo di stampa
      var printDiv = document.createElement('div');
      printDiv.className = 'print-all-recipes-container';

      var html = '';
      recipes.forEach(function (recipe) {
        var cat = Utils.getCategoryInfo(recipe.category);
        var totalTime = Utils.getTotalTime(recipe.prepTime, recipe.cookTime);
        var diffEmoji = Utils.getDifficultyEmoji(recipe.difficulty);

        html += '<article class="print-cookbook-recipe">';

        // Title
        html += '<h1 class="recipe-detail__title">' + esc(recipe.name) + '</h1>';

        // Category
        html += '<span class="recipe-card__category" style="border-color:' + esc(cat.color) + ';color:' + esc(cat.color) + '">' +
                  esc(cat.icon) + ' ' + esc(cat.label) +
                '</span>';

        // Info Bar
        html +=
          '<div class="recipe-detail__info-bar">' +
            '<div class="recipe-detail__info-item"><span>' + Icons.clock + '</span><span>Prep: ' + esc(Utils.formatTime(recipe.prepTime || 0)) + '</span></div>' +
            '<div class="recipe-detail__info-item"><span>' + Icons.flame + '</span><span>Cottura: ' + esc(Utils.formatTime(recipe.cookTime || 0)) + '</span></div>' +
            '<div class="recipe-detail__info-item"><span>' + esc(diffEmoji) + '</span><span>' + esc(recipe.difficulty || 'facile') + '</span></div>' +
            '<div class="recipe-detail__info-item"><span>' + Icons.users + '</span><span>' + (recipe.servings || 4) + ' porzioni</span></div>' +
          '</div>';

        // Description
        if (recipe.description) {
          html += '<div class="recipe-detail__section recipe-detail__description-section">' +
                    '<h3 class="recipe-detail__description-title">Descrizione</h3>' +
                    '<p>' + esc(recipe.description) + '</p>' +
                  '</div>';
        }

        // Body layout: ingredients + steps side-by-side
        html += '<div class="recipe-detail__body-layout">';

        // Ingredients
        html +=
          '<div class="recipe-detail__section recipe-detail__ingredients-section">' +
            '<h2 class="recipe-detail__section-title">Ingredienti</h2>' +
            '<ul class="ingredient-list">';
        if (recipe.ingredients && recipe.ingredients.length > 0) {
          recipe.ingredients.forEach(function (ing) {
            var parts = [];
            if (ing.quantity) parts.push(esc(ing.quantity));
            if (ing.unit) parts.push(esc(ing.unit));
            parts.push(esc(ing.name));
            html += '<li class="ingredient-item"><span class="ingredient-bullet">•</span> ' + parts.join(' ') + '</li>';
          });
        }
        html += '</ul></div>';

        // Steps
        html +=
          '<div class="recipe-detail__section recipe-detail__steps-section">' +
            '<h2 class="recipe-detail__section-title">Preparazione</h2>' +
            '<ol class="step-list">';
        if (recipe.steps && recipe.steps.length > 0) {
          recipe.steps.forEach(function (step, idx) {
            html +=
              '<li class="step-item">' +
                '<span class="step-number">' + (idx + 1) + '</span>' +
                '<p>' + esc(step) + '</p>' +
              '</li>';
          });
        }
        html += '</ol></div>';

        html += '</div>'; // close body-layout

        // Print-only footer box (replicates the RICETTARIO UFFICIALE.pdf bottom layout)
        html +=
          '<div class="print-footer-container">' +
            '<div class="print-photo-box">' +
              (recipe.image ? '<img src="' + esc(recipe.image) + '" alt="Foto Ricetta">' : '<span class="print-photo-label">FOTO</span>') +
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
      document.body.classList.add('printing-all-recipes');

      // Attiva la stampa
      setTimeout(function () {
        window.print();
        document.body.classList.remove('printing-all-recipes');
        if (printDiv.parentNode) {
          printDiv.parentNode.removeChild(printDiv);
        }
      }, 150);

    } catch (err) {
      Utils.showToast('Errore durante la creazione del PDF', 'error');
    }
  }

  async function importData() {
    var fileInput = document.getElementById('import-file-input');
    if (fileInput) fileInput.click();
  }

  async function handleImportFile(file) {
    if (!file) return;
    try {
      var text = await Utils.readFileAsText(file);
      var count = await DB.importData(text);
      Utils.showToast('Importate ' + count + ' ricette con successo! 📤', 'success');
      // Re-render settings to update count
      if (state.currentView === 'settings') {
        Views.renderSettings(appContent);
      }
    } catch (e) {
      Utils.showToast('Errore nell\'importazione: ' + e.message, 'error');
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
      updateThemeIcon();
    });

    // Modal overlay click (close)
    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) {
        Views.hideModal();
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

    // Global delegated click handler for dynamic content
    document.addEventListener('click', function (e) {
      var target = e.target;
      var actionEl = target.closest('[data-action]');
      if (!actionEl) {
        // Check for special elements without data-action
        handleNonActionClick(e);
        return;
      }

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
        case 'go-back': {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            navigateTo('#home');
          }
          break;
        }
        case 'edit-recipe': {
          var editId = actionEl.getAttribute('data-id');
          if (editId) navigateTo('#edit/' + editId);
          break;
        }
        case 'export-pdf': {
          window.print();
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
                performNavigate();
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
          var id = label.toLowerCase().replace(/[^a-z0-9]/g, '-');
          
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
          if (catId) deleteCustomCategory(catId);
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
        Theme.toggleDarkMode().then(function () {
          updateThemeIcon();
        });
      }
    });

    // Form submission
    document.addEventListener('submit', function (e) {
      if (e.target.id === 'recipe-form') {
        e.preventDefault();
        saveRecipe();
      }
    });

    // Image upload area click (delegate)
    document.addEventListener('click', function (e) {
      var placeholder = e.target.closest('.image-upload__placeholder');
      var uploadArea = e.target.closest('.image-upload');
      // Only trigger if clicking placeholder or the upload area itself (not remove button)
      if (placeholder || (uploadArea && !e.target.closest('.image-upload__remove') && !e.target.closest('.image-upload__preview img'))) {
        if (uploadArea && !e.target.closest('.image-upload__preview')) {
          triggerImageUpload();
        }
      }
    });

    // Sort select change
    document.addEventListener('change', function (e) {
      if (e.target.id === 'sort-select') {
        state.filters.sortBy = e.target.value;
        if (state.currentView === 'home') {
          Views.renderHome(appContent, state.filters);
        }
      }
    });

    // PWA Custom Install Prompt setup
    setupInstallPrompt();
  }

  /* ── Handle clicks on elements without data-action ── */
  function handleNonActionClick(e) {
    // Recipe card click (the card itself is the data-action element, handled above)
    // Nothing extra needed here
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
      
      var dismissedTime = localStorage.getItem('sapori-install-dismissed');
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
      var dismissedTime = localStorage.getItem('sapori-install-dismissed');
      var now = Date.now();
      if (!dismissedTime || (now - parseInt(dismissedTime, 10)) > 7 * 24 * 60 * 60 * 1000) {
        var promptTitle = document.querySelector('.install-prompt__title');
        var promptDesc = document.querySelector('.install-prompt__description');
        var promptConfirm = document.getElementById('btn-install-confirm');
        
        if (promptTitle) promptTitle.textContent = "Installa Sapori su iPhone";
        if (promptDesc) promptDesc.innerHTML = "Tocca il tasto di **Condivisione** <span style=\"font-size:1.1rem;\">⎋</span> in Safari e seleziona **\"Aggiungi alla schermata Home\"**.";
        
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
        localStorage.setItem('sapori-install-dismissed', Date.now().toString());
      });
    }
  }

  /* ──────────────────── DATA LOSS WARNING MODAL ──────────────────── */

  function setupDataWarning() {
    var warningModal = document.getElementById('warning-modal');
    var btnClose = document.getElementById('btn-warning-close');
    var btnDontShow = document.getElementById('btn-warning-dontshow');

    if (!warningModal) return;

    var dismissed = localStorage.getItem('sapori-warning-dismissed');
    if (dismissed !== 'true') {
      warningModal.classList.remove('hidden');
    }

    if (btnClose) {
      btnClose.addEventListener('click', function () {
        warningModal.classList.add('hidden');
      });
    }

    if (btnDontShow) {
      btnDontShow.addEventListener('click', function () {
        localStorage.setItem('sapori-warning-dismissed', 'true');
        warningModal.classList.add('hidden');
      });
    }
  }

  /* ──────────────────── SERVICE WORKER ──────────────────── */

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(function (reg) {
          console.log('Service Worker registrato con successo', reg.scope);
        })
        .catch(function (err) {
          console.error('Registrazione Service Worker fallita:', err);
        });
    }
  }

  /* ──────────────────── BOOT ──────────────────── */

  init().catch(function (err) {
    console.error('Errore inizializzazione app:', err);
  });

})();
