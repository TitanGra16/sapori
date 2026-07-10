/**
 * Sapori — Views Module
 * Renders all application views into the DOM.
 * Every user-provided string is escaped via Utils.escapeHtml() to prevent XSS.
 */
window.Views = (function () {
  'use strict';

  /* ──────────────────── HELPERS ──────────────────── */

  function recipeCardHTML(recipe, index) {
    const esc = Utils.escapeHtml;
    const cat = Utils.getCategoryInfo(recipe.category);
    const totalTime = Utils.getTotalTime(recipe.prepTime, recipe.cookTime);
    const diffEmoji = Utils.getDifficultyEmoji(recipe.difficulty);
    const stagger = (index % 8) + 1;
    const favClass = recipe.isFavorite ? 'active' : '';

    let imageBlock;
    if (recipe.image) {
      imageBlock = '<div class="recipe-card__image"><img src="' + esc(recipe.image) + '" alt="' + esc(recipe.name) + '" loading="lazy"></div>';
    } else {
      imageBlock =
        '<div class="recipe-card__placeholder" style="background:' + esc(cat.color) + '">' +
          '<span style="font-size:2.5rem">' + esc(cat.icon) + '</span>' +
        '</div>';
    }

    return (
      '<article class="recipe-card animate-scale-in stagger-' + stagger + '" data-id="' + esc(recipe.id) + '" data-action="open-recipe">' +
        imageBlock +
        '<div class="recipe-card__content">' +
          '<h3 class="recipe-card__title">' + esc(recipe.name) + '</h3>' +
          '<div class="recipe-card__meta">' +
            '<span class="recipe-card__meta-item">⏱️ ' + esc(totalTime) + '</span>' +
            '<span class="recipe-card__meta-item">' + esc(diffEmoji) + '</span>' +
          '</div>' +
          '<span class="recipe-card__category" style="background:' + esc(cat.color) + '22;color:' + esc(cat.color) + '">' +
            esc(cat.icon) + ' ' + esc(cat.label) +
          '</span>' +
        '</div>' +
        '<button type="button" class="recipe-card__favorite ' + favClass + '" data-action="toggle-fav" data-id="' + esc(recipe.id) + '" aria-label="Preferito">' +
          (recipe.isFavorite ? '❤️' : '🤍') +
        '</button>' +
      '</article>'
    );
  }

  function recipeGridHTML(recipes) {
    if (!recipes || recipes.length === 0) return '';
    return '<div class="recipe-grid">' + recipes.map(function (r, i) { return recipeCardHTML(r, i); }).join('') + '</div>';
  }

  function emptyStateHTML(icon, title, description, buttonLabel, buttonAction) {
    var html =
      '<div class="empty-state animate-fade-in">' +
        '<div class="empty-state__icon">' + icon + '</div>' +
        '<h2 class="empty-state__title">' + Utils.escapeHtml(title) + '</h2>' +
        '<p class="empty-state__description">' + Utils.escapeHtml(description) + '</p>';
    if (buttonLabel && buttonAction) {
      html += '<button type="button" class="btn btn--primary" data-action="' + Utils.escapeHtml(buttonAction) + '">' + Utils.escapeHtml(buttonLabel) + '</button>';
    }
    html += '</div>';
    return html;
  }

  function categoryChipsHTML(activeCategory) {
    var esc = Utils.escapeHtml;
    var html = '<div class="filter-bar">';
    html += '<button type="button" class="filter-chip' + (activeCategory === '' ? ' active' : '') + '" data-action="filter-category" data-category="">' +
              '🍽️ Tutte</button>';
    Recipes.CATEGORIES.forEach(function (cat) {
      html += '<button type="button" class="filter-chip' + (activeCategory === cat.id ? ' active' : '') + '" data-action="filter-category" data-category="' + esc(cat.id) + '">' +
                esc(cat.icon) + ' ' + esc(cat.label) +
              '</button>';
    });
    html += '</div>';
    return html;
  }

  function sortBarHTML(currentSort) {
    var esc = Utils.escapeHtml;
    var options = [
      { value: 'recent', label: 'Più recenti' },
      { value: 'oldest', label: 'Meno recenti' },
      { value: 'name-az', label: 'Nome A-Z' },
      { value: 'name-za', label: 'Nome Z-A' },
      { value: 'time-asc', label: 'Tempo ↑' },
      { value: 'time-desc', label: 'Tempo ↓' }
    ];
    var html = '<div class="sort-select"><select id="sort-select" data-action="sort-change" aria-label="Ordina ricette">';
    options.forEach(function (opt) {
      html += '<option value="' + esc(opt.value) + '"' + (currentSort === opt.value ? ' selected' : '') + '>' + esc(opt.label) + '</option>';
    });
    html += '</select></div>';
    return html;
  }

  /* ──────────────────── HOME VIEW ──────────────────── */

  async function renderHome(container, filters) {
    filters = filters || { search: '', category: '', sortBy: 'recent' };

    var recipes = await DB.getAllRecipes();

    var sortMap = {
      'recent': 'recent',
      'oldest': 'oldest',
      'name-az': 'name-az',
      'name-za': 'name-za',
      'time-asc': 'time-asc',
      'time-desc': 'time-desc'
    };

    var filtered = Recipes.filterRecipes(recipes, {
      search: filters.search,
      category: filters.category,
      sortBy: sortMap[filters.sortBy] || 'recent'
    });

    var html = '<div class="view animate-fade-in">';
    html += categoryChipsHTML(filters.category);
    html += sortBarHTML(filters.sortBy);

    if (filtered.length > 0) {
      html += recipeGridHTML(filtered);
    } else if (recipes.length === 0) {
      html += emptyStateHTML('📖', 'Nessuna ricetta ancora!', 'Inizia creando la tua prima ricetta', 'Crea Ricetta', 'go-create');
    } else {
      html += emptyStateHTML('🔍', 'Nessun risultato', 'Prova a cambiare i filtri di ricerca', null, null);
    }

    html += '</div>';
    container.innerHTML = html;
  }

  /* ──────────────────── CREATE / EDIT VIEW ──────────────────── */

  function renderCreate(container, recipe) {
    var isEdit = !!recipe;
    var r = recipe || Recipes.createEmptyRecipe();
    var esc = Utils.escapeHtml;

    var title = isEdit ? 'Modifica Ricetta' : 'Nuova Ricetta';

    // Ensure at least 1 ingredient row
    if (!r.ingredients || r.ingredients.length === 0) {
      r.ingredients = [{ name: '', quantity: '', unit: '' }];
    }
    // Ensure at least 1 step
    if (!r.steps || r.steps.length === 0) {
      r.steps = [''];
    }

    var html = '<div class="view animate-fade-in">';
    html += '<div class="view-header"><h1 class="view-header__title">' + esc(title) + '</h1></div>';
    html += '<form id="recipe-form" class="recipe-form" novalidate>';

    // Hidden field for ID in edit mode
    if (isEdit) {
      html += '<input type="hidden" id="input-id" value="' + esc(r.id) + '">';
    }

    // Nome
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-name">Nome ricetta *</label>' +
        '<input type="text" class="form-input" id="input-name" placeholder="Es. Carbonara" value="' + esc(r.name) + '" required>' +
        '<span class="form-error" id="error-name"></span>' +
      '</div>';

    // Categoria
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-category">Categoria *</label>' +
        '<select class="form-select" id="input-category" required>';
    html += '<option value="">Seleziona categoria...</option>';
    Recipes.CATEGORIES.forEach(function (cat) {
      var sel = r.category === cat.id ? ' selected' : '';
      html += '<option value="' + esc(cat.id) + '"' + sel + '>' + esc(cat.icon) + ' ' + esc(cat.label) + '</option>';
    });
    html += '</select><span class="form-error" id="error-category"></span></div>';

    // Descrizione
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-description">Descrizione</label>' +
        '<textarea class="form-textarea" id="input-description" rows="3" placeholder="Una breve descrizione della ricetta...">' + esc(r.description || '') + '</textarea>' +
      '</div>';

    // Immagine
    html += '<div class="form-group">';
    html += '<label class="form-label">Foto</label>';
    html += '<div class="image-upload" id="image-upload-area">';
    if (r.image) {
      html +=
        '<div class="image-upload__preview">' +
          '<img src="' + esc(r.image) + '" alt="Anteprima" id="image-preview">' +
          '<button type="button" class="image-upload__remove" data-action="remove-image" aria-label="Rimuovi foto">✕</button>' +
        '</div>';
    } else {
      html +=
        '<div class="image-upload__placeholder" id="image-placeholder">' +
          '<span style="font-size:2rem">📷</span>' +
          '<span>Tocca per aggiungere una foto</span>' +
        '</div>';
    }
    html += '</div>';
    html += '<input type="file" id="input-image" accept="image/*" class="hidden" aria-label="Seleziona foto">';
    html += '<input type="hidden" id="input-image-data" value="' + esc(r.image || '') + '">';
    html += '</div>';

    // Ingredienti
    html +=
      '<div class="form-group">' +
        '<label class="form-label">Ingredienti *</label>' +
        '<span class="form-error" id="error-ingredients"></span>' +
        '<div class="dynamic-list" id="ingredients-list">';
    r.ingredients.forEach(function (ing, idx) {
      html += ingredientRowHTML(ing, idx, r.ingredients.length);
    });
    html += '</div>';
    html += '<button type="button" class="dynamic-list__add btn btn--ghost btn--small" data-action="add-ingredient">➕ Aggiungi ingrediente</button>';
    html += '</div>';

    // Passaggi
    html +=
      '<div class="form-group">' +
        '<label class="form-label">Preparazione *</label>' +
        '<span class="form-error" id="error-steps"></span>' +
        '<div class="dynamic-list" id="steps-list">';
    r.steps.forEach(function (step, idx) {
      html += stepRowHTML(step, idx, r.steps.length);
    });
    html += '</div>';
    html += '<button type="button" class="dynamic-list__add btn btn--ghost btn--small" data-action="add-step">➕ Aggiungi passaggio</button>';
    html += '</div>';

    // Tempo preparazione
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-preptime">Tempo preparazione (minuti)</label>' +
        '<input type="number" class="form-input" id="input-preptime" min="0" placeholder="0" value="' + (r.prepTime || '') + '">' +
      '</div>';

    // Tempo cottura
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-cooktime">Tempo cottura (minuti)</label>' +
        '<input type="number" class="form-input" id="input-cooktime" min="0" placeholder="0" value="' + (r.cookTime || '') + '">' +
      '</div>';

    // Difficoltà
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-difficulty">Difficoltà</label>' +
        '<select class="form-select" id="input-difficulty">';
    Recipes.DIFFICULTIES.forEach(function (d) {
      var sel = r.difficulty === d.id ? ' selected' : '';
      html += '<option value="' + esc(d.id) + '"' + sel + '>' + esc(d.emoji) + ' ' + esc(d.label) + '</option>';
    });
    html += '</select></div>';

    // Porzioni
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-servings">Porzioni</label>' +
        '<input type="number" class="form-input" id="input-servings" min="1" placeholder="4" value="' + (r.servings || '') + '">' +
      '</div>';

    // Buttons
    html +=
      '<div class="form-group" style="display:flex;gap:.75rem;padding-top:.5rem">' +
        '<button type="submit" class="btn btn--primary" style="flex:1">' + (isEdit ? '💾 Salva Modifiche' : '💾 Salva Ricetta') + '</button>' +
        '<button type="button" class="btn btn--ghost" data-action="cancel-form" style="flex:0 0 auto">Annulla</button>' +
      '</div>';

    html += '</form></div>';
    container.innerHTML = html;
  }

  function ingredientRowHTML(ing, index, total) {
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

  function stepRowHTML(step, index, total) {
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

  /* ──────────────────── DETAIL VIEW ──────────────────── */

  async function renderDetail(container, recipeId) {
    var esc = Utils.escapeHtml;
    var recipe;

    try {
      recipe = await DB.getRecipe(recipeId);
    } catch (e) {
      recipe = null;
    }

    if (!recipe) {
      container.innerHTML = emptyStateHTML('😕', 'Ricetta non trovata', 'La ricetta richiesta non esiste più', 'Torna alla Home', 'go-home');
      return;
    }

    var cat = Utils.getCategoryInfo(recipe.category);
    var totalTime = Utils.getTotalTime(recipe.prepTime, recipe.cookTime);
    var diffEmoji = Utils.getDifficultyEmoji(recipe.difficulty);
    var favClass = recipe.isFavorite ? ' active' : '';

    var html = '<div class="view recipe-detail animate-fade-in">';

    // Hero
    if (recipe.image) {
      html +=
        '<div class="recipe-detail__hero">' +
          '<img src="' + esc(recipe.image) + '" alt="' + esc(recipe.name) + '">' +
          '<div class="recipe-detail__hero-overlay"></div>';
    } else {
      html +=
        '<div class="recipe-detail__hero-placeholder" style="background:linear-gradient(135deg,' + esc(cat.color) + ',' + esc(cat.color) + '88)">' +
          '<span style="font-size:4rem">' + esc(cat.icon) + '</span>';
    }
    // Overlay buttons
    html +=
      '<button type="button" class="recipe-detail__back" data-action="go-back" aria-label="Indietro">←</button>' +
      '<button type="button" class="recipe-detail__actions recipe-card__favorite' + favClass + '" data-action="toggle-fav-detail" data-id="' + esc(recipe.id) + '" aria-label="Preferito">' +
        (recipe.isFavorite ? '❤️' : '🤍') +
      '</button>';
    html += '</div>';

    // Title
    html += '<h1 class="recipe-detail__title">' + esc(recipe.name) + '</h1>';

    // Category badge
    html += '<span class="recipe-card__category" style="background:' + esc(cat.color) + '22;color:' + esc(cat.color) + ';display:inline-block;margin:0 1rem .75rem">' +
              esc(cat.icon) + ' ' + esc(cat.label) +
            '</span>';

    // Info bar
    html +=
      '<div class="recipe-detail__info-bar">' +
        '<div class="recipe-detail__info-item"><span>⏱️</span><span>Prep: ' + esc(Utils.formatTime(recipe.prepTime || 0)) + '</span></div>' +
        '<div class="recipe-detail__info-item"><span>🍳</span><span>Cottura: ' + esc(Utils.formatTime(recipe.cookTime || 0)) + '</span></div>' +
        '<div class="recipe-detail__info-item"><span>' + esc(diffEmoji) + '</span><span>' + esc(recipe.difficulty || 'facile') + '</span></div>' +
        '<div class="recipe-detail__info-item"><span>👥</span><span>' + (recipe.servings || 4) + ' porzioni</span></div>' +
      '</div>';

    // Description
    if (recipe.description) {
      html +=
        '<div class="recipe-detail__section">' +
          '<p>' + esc(recipe.description) + '</p>' +
        '</div>';
    }

    // Ingredienti
    html +=
      '<div class="recipe-detail__section">' +
        '<h2 class="recipe-detail__section-title">🧂 Ingredienti</h2>' +
        '<ul class="ingredient-list">';
    if (recipe.ingredients && recipe.ingredients.length > 0) {
      recipe.ingredients.forEach(function (ing) {
        var parts = [];
        if (ing.quantity) parts.push(esc(ing.quantity));
        if (ing.unit) parts.push(esc(ing.unit));
        parts.push(esc(ing.name));
        html += '<li class="ingredient-item">• ' + parts.join(' ') + '</li>';
      });
    }
    html += '</ul></div>';

    // Preparazione
    html +=
      '<div class="recipe-detail__section">' +
        '<h2 class="recipe-detail__section-title">👨‍🍳 Preparazione</h2>' +
        '<ol class="step-list">';
    if (recipe.steps && recipe.steps.length > 0) {
      recipe.steps.forEach(function (step, idx) {
        html +=
          '<li class="step-item animate-slide-up stagger-' + ((idx % 8) + 1) + '">' +
            '<span class="step-number">' + (idx + 1) + '</span>' +
            '<p>' + esc(step) + '</p>' +
          '</li>';
      });
    }
    html += '</ol></div>';

    // Action buttons
    html +=
      '<div class="recipe-detail__section" style="display:flex;gap:.75rem;flex-wrap:wrap">' +
        '<button type="button" class="btn btn--secondary" data-action="edit-recipe" data-id="' + esc(recipe.id) + '">✏️ Modifica</button>' +
        '<button type="button" class="btn btn--danger" data-action="delete-recipe" data-id="' + esc(recipe.id) + '">🗑️ Elimina</button>' +
      '</div>';

    // Dates
    html +=
      '<div class="recipe-detail__section" style="font-size:.8rem;opacity:.6">' +
        '<p>Creata il ' + esc(Utils.formatDateTime(recipe.createdAt)) + '</p>' +
        (recipe.updatedAt && recipe.updatedAt !== recipe.createdAt
          ? '<p>Modificata il ' + esc(Utils.formatDateTime(recipe.updatedAt)) + '</p>'
          : '') +
      '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  /* ──────────────────── FAVORITES VIEW ──────────────────── */

  async function renderFavorites(container) {
    var recipes = await DB.getAllRecipes();
    var favs = recipes.filter(function (r) { return r.isFavorite; });

    var html = '<div class="view animate-fade-in">';
    html += '<div class="view-header"><h1 class="view-header__title">❤️ I Miei Preferiti</h1></div>';

    if (favs.length > 0) {
      html += recipeGridHTML(favs);
    } else {
      html += emptyStateHTML('💔', 'Nessun preferito!', 'Tocca il cuore su una ricetta per aggiungerla qui', null, null);
    }

    html += '</div>';
    container.innerHTML = html;
  }

  /* ──────────────────── SETTINGS VIEW ──────────────────── */

  async function renderSettings(container) {
    var esc = Utils.escapeHtml;
    var theme = Theme.getCurrentTheme();
    var isDark = theme.mode === 'dark';
    var currentPalette = theme.palette || 'classico';
    var recipes = await DB.getAllRecipes();
    var count = recipes.length;

    var palettes = [
      { id: 'classico', label: 'Classico', gradient: 'linear-gradient(135deg,#E85D3A,#C0392B)' },
      { id: 'oceano', label: 'Oceano', gradient: 'linear-gradient(135deg,#2980B9,#3498DB)' },
      { id: 'bosco', label: 'Bosco', gradient: 'linear-gradient(135deg,#27AE60,#2ECC71)' },
      { id: 'tramonto', label: 'Tramonto', gradient: 'linear-gradient(135deg,#8E44AD,#E91E63)' }
    ];

    var html = '<div class="view animate-fade-in">';
    html += '<div class="view-header"><h1 class="view-header__title">⚙️ Impostazioni</h1></div>';

    // — Aspetto —
    html += '<div class="settings-section">';
    html += '<h2 class="settings-section__title">🎨 Aspetto</h2>';

    // Dark mode toggle
    html +=
      '<div class="settings-item">' +
        '<div>' +
          '<div class="settings-item__label">Tema scuro</div>' +
          '<div class="settings-item__description">Attiva la modalità scura per riposare gli occhi</div>' +
        '</div>' +
        '<div class="settings-item__control">' +
          '<label class="toggle-switch">' +
            '<input type="checkbox" data-action="toggle-dark"' + (isDark ? ' checked' : '') + '>' +
            '<span class="toggle-slider"></span>' +
          '</label>' +
        '</div>' +
      '</div>';

    // Palette
    html +=
      '<div class="settings-item" style="flex-direction:column;align-items:flex-start">' +
        '<div class="settings-item__label">Palette colori</div>' +
        '<div class="theme-selector">';
    palettes.forEach(function (p) {
      html +=
        '<button type="button" class="theme-option' + (currentPalette === p.id ? ' active' : '') + '" data-action="set-palette" data-palette="' + esc(p.id) + '" aria-label="' + esc(p.label) + '">' +
          '<span style="display:block;width:2.5rem;height:2.5rem;border-radius:50%;background:' + p.gradient + '"></span>' +
          '<span style="font-size:.75rem;margin-top:.25rem">' + esc(p.label) + '</span>' +
        '</button>';
    });
    html += '</div></div>';
    html += '</div>';

    // — Gestione Dati —
    html += '<div class="settings-section">';
    html += '<h2 class="settings-section__title">💾 Gestione Dati</h2>';

    html +=
      '<div class="settings-item">' +
        '<div>' +
          '<div class="settings-item__label">Hai <strong>' + count + '</strong> ricett' + (count === 1 ? 'a' : 'e') + ' salvat' + (count === 1 ? 'a' : 'e') + '</div>' +
        '</div>' +
      '</div>';

    html +=
      '<div class="settings-item">' +
        '<button type="button" class="btn btn--secondary btn--small" data-action="export-data">📥 Esporta Ricette</button>' +
        '<button type="button" class="btn btn--secondary btn--small" data-action="import-data">📤 Importa Ricette</button>' +
        '<input type="file" id="import-file-input" accept=".json,application/json" class="hidden">' +
      '</div>';
    html += '</div>';

    // — Informazioni —
    html += '<div class="settings-section">';
    html += '<h2 class="settings-section__title">ℹ️ Informazioni</h2>';

    html +=
      '<div class="settings-item"><div><div class="settings-item__label">Versione</div><div class="settings-item__description">1.0.0</div></div></div>' +
      '<div class="settings-item"><div><div class="settings-item__label">Sapori — Il tuo ricettario personale</div></div></div>' +
      '<div class="settings-item"><div><div class="settings-item__description">Creato con ❤️ in Italia</div></div></div>' +
      '<div class="settings-item"><div><div class="settings-item__description">🔒 I tuoi dati sono salvati localmente sul dispositivo</div></div></div>';

    html += '</div>';
    html += '</div>';

    container.innerHTML = html;
  }

  /* ──────────────────── MODAL ──────────────────── */

  function showConfirmModal(title, message, onConfirm) {
    var esc = Utils.escapeHtml;
    var overlay = document.getElementById('modal-overlay');

    overlay.innerHTML =
      '<div class="modal animate-slide-up">' +
        '<div class="modal__header"><h3>' + esc(title) + '</h3></div>' +
        '<div class="modal__body"><p>' + esc(message) + '</p></div>' +
        '<div class="modal__footer">' +
          '<button type="button" class="btn btn--ghost" data-action="modal-cancel">Annulla</button>' +
          '<button type="button" class="btn btn--danger" data-action="modal-confirm">Conferma</button>' +
        '</div>' +
      '</div>';

    overlay.classList.remove('hidden');

    // Store callback for app.js to use
    overlay._onConfirm = onConfirm;
  }

  function hideModal() {
    var overlay = document.getElementById('modal-overlay');
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    overlay._onConfirm = null;
  }

  /* ──────────────────── PUBLIC API ──────────────────── */

  return {
    renderHome: renderHome,
    renderCreate: renderCreate,
    renderDetail: renderDetail,
    renderFavorites: renderFavorites,
    renderSettings: renderSettings,
    showConfirmModal: showConfirmModal,
    hideModal: hideModal
  };

})();
