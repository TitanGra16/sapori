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
    const favClass = recipe.isFavorite ? 'is-favorite' : '';

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
          (recipe.isFavorite ? Icons.heartFilled : Icons.heartOutline) +
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
    html += '<button type="button" class="filter-chip filter-chip--pantry" data-action="go-pantry" style="background:linear-gradient(135deg,#E85D3A,#FFA726);color:#fff;font-weight:600;border:none;">' +
              '👨‍🍳 Svuotafrigo</button>';
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
      html += emptyStateHTML(Icons.bookOpen, 'Nessuna ricetta ancora!', 'Inizia creando la tua prima ricetta', 'Crea Ricetta', 'go-create');
    } else {
      html += emptyStateHTML(Icons.searchLg, 'Nessun risultato', 'Prova a cambiare i filtri di ricerca', null, null);
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
    html += '<div class="view-header" style="display:flex; align-items:center; gap:var(--space-sm);">';
    html += '<button type="button" class="btn btn--icon" data-action="cancel-form" aria-label="Annulla e torna indietro" style="margin-right:var(--space-xs); border:1px solid var(--border); background:var(--glass-bg); backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); color:var(--text-primary); width:40px; height:40px; border-radius:var(--radius-full); display:flex; align-items:center; justify-content:center; cursor:pointer;">' + Icons.arrowLeft + '</button>';
    html += '<h1 class="view-header__title" style="margin:0;">' + esc(title) + '</h1></div>';
    
    // Step Navigation Header
    html +=
      '<div class="form-steps-nav">' +
        '<button type="button" class="form-steps-btn active" data-action="switch-tab" data-target="tab-info" aria-label="Informazioni generali">' +
          '<span class="step-num">1</span>' +
          '<span class="step-lbl">Info</span>' +
        '</button>' +
        '<div class="form-steps-line"></div>' +
        '<button type="button" class="form-steps-btn" data-action="switch-tab" data-target="tab-prep" aria-label="Ingredienti e preparazione">' +
          '<span class="step-num">2</span>' +
          '<span class="step-lbl">Preparazione</span>' +
        '</button>' +
        '<div class="form-steps-line"></div>' +
        '<button type="button" class="form-steps-btn" data-action="switch-tab" data-target="tab-cook" aria-label="Dettagli di cottura">' +
          '<span class="step-num">3</span>' +
          '<span class="step-lbl">Cottura</span>' +
        '</button>' +
      '</div>';

    html += '<form id="recipe-form" class="recipe-form" novalidate>';

    // Hidden field for ID in edit mode
    if (isEdit) {
      html += '<input type="hidden" id="input-id" value="' + esc(r.id) + '">';
    }

    // ──────────────────── TAB 1: INFO ────────────────────
    html += '<div id="tab-info" class="form-tab active">';
    
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
        '<label class="form-label">Categoria *</label>' +
        '<input type="hidden" id="input-category" value="' + esc(r.category || '') + '" required>' +
        '<div class="category-selector-grid">';
    Recipes.CATEGORIES.forEach(function (cat) {
      var activeClass = r.category === cat.id ? ' active' : '';
      html +=
        '<button type="button" class="category-select-btn' + activeClass + '" data-action="select-form-category" data-category="' + esc(cat.id) + '">' +
          '<span class="category-select-btn__icon">' + esc(cat.icon) + '</span>' +
          '<span class="category-select-btn__label">' + esc(cat.label) + '</span>' +
        '</button>';
    });
    html += '</div><span class="form-error" id="error-category"></span></div>';

    // Descrizione
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-description">Descrizione</label>' +
        '<textarea class="form-textarea" id="input-description" rows="3" placeholder="Una breve descrizione della ricetta...">' + esc(r.description || '') + '</textarea>' +
      '</div>';

    // Note
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-notes">Note</label>' +
        '<textarea class="form-textarea" id="input-notes" rows="3" placeholder="Annotazioni personali, consigli di conservazione, varianti...">' + esc(r.notes || '') + '</textarea>' +
      '</div>';

    // Immagine
    html += '<div class="form-group">';
    html += '<label class="form-label">Foto</label>';
    html += '<div class="image-upload" id="image-upload-area">';
    if (r.image) {
      html +=
        '<div class="image-upload__preview">' +
          '<img src="' + esc(r.image) + '" alt="Anteprima" id="image-preview">' +
          '<button type="button" class="image-upload__remove" data-action="remove-image" aria-label="Rimuovi foto">' + Icons.x + '</button>' +
        '</div>';
    } else {
      html +=
        '<div class="image-upload__placeholder" id="image-placeholder">' +
          Icons.camera +
          '<span>Tocca per aggiungere una foto</span>' +
        '</div>';
    }
    html += '</div>';
    html += '<input type="file" id="input-image" accept="image/*" class="hidden" aria-label="Seleziona foto">';
    html += '<input type="hidden" id="input-image-data" value="' + esc(r.image || '') + '">';
    html += '</div>';

    // Tab 1 Actions
    html +=
      '<div class="form-tab-actions">' +
        '<button type="button" class="btn btn--primary" data-action="next-tab" data-next="tab-prep">Avanti</button>' +
      '</div>';

    html += '</div>'; // close tab-info

    // ──────────────────── TAB 2: PREPARATION ────────────────────
    html += '<div id="tab-prep" class="form-tab">';

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
    html += '<button type="button" class="dynamic-list__add btn btn--ghost btn--small" data-action="add-ingredient">' + Icons.plus + ' Aggiungi ingrediente</button>';
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
    html += '<button type="button" class="dynamic-list__add btn btn--ghost btn--small" data-action="add-step">' + Icons.plus + ' Aggiungi passaggio</button>';
    html += '</div>';

    // Tab 2 Actions
    html +=
      '<div class="form-tab-actions">' +
        '<button type="button" class="btn btn--ghost" data-action="prev-tab" data-prev="tab-info">Indietro</button>' +
        '<button type="button" class="btn btn--primary" data-action="next-tab" data-next="tab-cook">Avanti</button>' +
      '</div>';

    html += '</div>'; // close tab-prep

    // ──────────────────── TAB 3: COOKING ────────────────────
    html += '<div id="tab-cook" class="form-tab">';

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

    // Tab 3 Actions
    html +=
      '<div class="form-tab-actions" style="display:flex;gap:.75rem;padding-top:.5rem">' +
        '<button type="button" class="btn btn--ghost" data-action="prev-tab" data-prev="tab-prep">Indietro</button>' +
        '<button type="submit" class="btn btn--primary" style="flex:1">' + Icons.save + (isEdit ? ' Salva Modifiche' : ' Salva Ricetta') + '</button>' +
        '<button type="button" class="btn btn--ghost" data-action="cancel-form" style="flex:0 0 auto">Annulla</button>' +
      '</div>';

    html += '</div>'; // close tab-cook

    html += '</form></div>';
    container.innerHTML = html;
  }

  function ingredientRowHTML(ing, index, total) {
    var esc = Utils.escapeHtml;
    var html =
      '<div class="dynamic-list__item ingredient-row" data-index="' + index + '">' +
        '<div class="ingredient-row-container" style="flex: 1; display: flex; flex-direction: column; gap: 6px;">' +
          '<div class="ingredient-inputs">' +
            '<input type="text" class="form-input" placeholder="Ingrediente *" data-field="ing-name" value="' + esc(ing.name || '') + '" required>' +
            '<input type="text" class="form-input" placeholder="Qtà" data-field="ing-qty" value="' + esc(ing.quantity || '') + '" style="max-width:5rem">' +
            '<select class="form-select" data-field="ing-unit" style="max-width:6rem">' +
              '<option value="">—</option>';
    Recipes.UNITS.forEach(function (u) {
      html += '<option value="' + esc(u) + '"' + (ing.unit === u ? ' selected' : '') + '>' + esc(u) + '</option>';
    });
    html += '</select>';
    if (total > 1) {
      html += '<button type="button" class="btn btn--icon btn--small" data-action="remove-ingredient" data-index="' + index + '" aria-label="Rimuovi">' + Icons.x + '</button>';
    }
    html += '</div>';
    html += '<div class="ingredient-notes-container" style="' + (total > 1 ? 'padding-right: 42px;' : '') + '">' +
              '<input type="text" class="form-input" placeholder="Note per questo ingrediente (es. tiepido, setacciato)" data-field="ing-notes" value="' + esc(ing.notes || '') + '">' +
            '</div>' +
        '</div>' +
      '</div>';
    return html;
  }

  function stepRowHTML(stepVal, index, total) {
    var esc = Utils.escapeHtml;
    var stepText = typeof stepVal === 'object' ? stepVal.text : stepVal;
    var stepNotes = typeof stepVal === 'object' ? stepVal.notes : '';
    var html =
      '<div class="dynamic-list__item step-item" data-index="' + index + '">' +
        '<span class="step-number">' + (index + 1) + '</span>' +
        '<div class="step-inputs" style="flex: 1; display: flex; flex-direction: column; gap: 6px;">' +
          '<textarea class="form-textarea" data-field="step-text" rows="2" placeholder="Descrivi il passaggio *" required>' + esc(stepText || '') + '</textarea>' +
          '<input type="text" class="form-input" placeholder="Note per questo passaggio (es. attenzione a non far bollire)" data-field="step-notes" value="' + esc(stepNotes || '') + '">' +
        '</div>';
    if (total > 1) {
      html += '<button type="button" class="btn btn--icon btn--small" data-action="remove-step" data-index="' + index + '" aria-label="Rimuovi">' + Icons.x + '</button>';
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
      container.innerHTML = emptyStateHTML(Icons.frown, 'Ricetta non trovata', 'La ricetta richiesta non esiste più', 'Torna alla Home', 'go-home');
      return;
    }

    var cat = Utils.getCategoryInfo(recipe.category);
    var totalTime = Utils.getTotalTime(recipe.prepTime, recipe.cookTime);
    var diffEmoji = Utils.getDifficultyEmoji(recipe.difficulty);
    var favClass = recipe.isFavorite ? ' is-favorite' : '';

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
      '<button type="button" class="recipe-detail__back" data-action="go-back" aria-label="Indietro">' + Icons.arrowLeft + '</button>' +
      '<button type="button" class="recipe-detail__actions recipe-card__favorite' + favClass + '" data-action="toggle-fav-detail" data-id="' + esc(recipe.id) + '" aria-label="Preferito">' +
        (recipe.isFavorite ? Icons.heartFilled : Icons.heartOutline) +
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
        '<div class="recipe-detail__info-item"><span>' + Icons.clock + '</span><span>Prep: ' + esc(Utils.formatTime(recipe.prepTime || 0)) + '</span></div>' +
        '<div class="recipe-detail__info-item"><span>' + Icons.flame + '</span><span>Cottura: ' + esc(Utils.formatTime(recipe.cookTime || 0)) + '</span></div>' +
        '<div class="recipe-detail__info-item"><span>' + esc(diffEmoji) + '</span><span>' + esc(recipe.difficulty || 'facile') + '</span></div>' +
        '<div class="recipe-detail__info-item"><span>' + Icons.users + '</span>' +
          '<div style="display:inline-flex;align-items:center;gap:.3rem;">' +
            '<button type="button" class="btn btn--icon btn--small" data-action="scale-servings-down" aria-label="Riduci porzioni" style="width:22px;height:22px;min-width:22px;padding:0;font-size:12px;border:1px solid var(--border-color);border-radius:99px;line-height:1">-</button>' +
            '<span id="detail-servings-val" data-base-servings="' + (recipe.servings || 4) + '" style="font-weight:700;">' + (recipe.servings || 4) + '</span>' +
            '<span>porzioni</span>' +
            '<button type="button" class="btn btn--icon btn--small" data-action="scale-servings-up" aria-label="Aumenta porzioni" style="width:22px;height:22px;min-width:22px;padding:0;font-size:12px;border:1px solid var(--border-color);border-radius:99px;line-height:1">+</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Start Cooking Mode Button
    html +=
      '<div style="padding:0 1rem;margin-bottom:1.25rem">' +
        '<button type="button" class="btn btn--primary" data-action="start-cooking" data-id="' + esc(recipe.id) + '" style="width:100%;display:flex;align-items:center;justify-content:center;gap:.6rem;font-size:1.05rem;padding:1rem 1.25rem;border-radius:var(--radius-lg);font-weight:800;letter-spacing:.02em;background:var(--gradient);box-shadow:0 6px 20px var(--shadow);transition:all .2s;position:relative;overflow:hidden">' +
          '<span style="font-size:1.3rem;line-height:1">🍳</span>' +
          ' Inizia la Cottura' +
          '<span style="font-size:.8rem;opacity:.75;margin-left:.25rem">(Schermo Attivo)</span>' +
        '</button>' +
      '</div>';

    // Description
    if (recipe.description) {
      html +=
        '<div class="recipe-detail__section recipe-detail__description-section">' +
          '<h3 class="recipe-detail__description-title">Descrizione</h3>' +
          '<p>' + esc(recipe.description) + '</p>' +
        '</div>';
    }

    // Notes (replicates "NOTE" block in PDF export)
    html +=
      '<div class="recipe-detail__section recipe-detail__notes-section' + (recipe.notes ? '' : ' print-only') + '">' +
        '<h3 class="recipe-detail__notes-title">Note</h3>' +
        (recipe.notes 
          ? '<p>' + esc(recipe.notes) + '</p>' 
          : '<div class="print-dotted-line"></div><div class="print-dotted-line"></div><div class="print-dotted-line"></div>') +
      '</div>';

    // Wrap ingredients and steps in a layout container for desktop side-by-side / cookbook print layout
    html += '<div class="recipe-detail__body-layout">';

    // Ingredienti
    html +=
      '<div class="recipe-detail__section recipe-detail__ingredients-section">' +
        '<h2 class="recipe-detail__section-title">Ingredienti</h2>' +
        '<ul class="ingredient-list">';
    if (recipe.ingredients && recipe.ingredients.length > 0) {
      recipe.ingredients.forEach(function (ing) {
        var qtyPart = ing.quantity ? '<span class="ingredient-item__qty ing-qty" data-base-qty="' + esc(ing.quantity) + '">' + esc(ing.quantity) + (ing.unit ? ' ' + esc(ing.unit) : '') + '</span>' : '';
        var namePart = '<span class="ingredient-item__name ing-name">' + esc(ing.name) + '</span>';
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

    // Preparazione
    html +=
      '<div class="recipe-detail__section recipe-detail__steps-section">' +
        '<h2 class="recipe-detail__section-title">Preparazione</h2>' +
        '<ol class="step-list">';
    if (recipe.steps && recipe.steps.length > 0) {
      recipe.steps.forEach(function (stepVal, idx) {
        var stepText = typeof stepVal === 'object' ? stepVal.text : stepVal;
        var stepNotes = typeof stepVal === 'object' ? stepVal.notes : '';
        var notesHTML = stepNotes ? '<span class="step-item__notes">Note: ' + esc(stepNotes) + '</span>' : '';
        html +=
          '<li class="step-item animate-slide-up stagger-' + ((idx % 8) + 1) + '">' +
            '<span class="step-number">' + (idx + 1) + '</span>' +
            '<div class="step-content">' +
              '<p>' + esc(stepText) + '</p>' +
              notesHTML +
            '</div>' +
          '</li>';
      });
    }
    html += '</ol></div>';

    html += '</div>'; // close recipe-detail__body-layout

    // Action buttons
    html +=
      '<div class="recipe-detail__section recipe-detail__actions-row" style="display:flex;gap:.75rem;flex-wrap:wrap">' +
        '<button type="button" class="btn btn--secondary" data-action="edit-recipe" data-id="' + esc(recipe.id) + '">' + Icons.edit + ' Modifica</button>' +
        '<button type="button" class="btn btn--secondary" data-action="share-recipe" data-id="' + esc(recipe.id) + '">' + Icons.share + ' Condividi</button>' +
        '<button type="button" class="btn btn--secondary" data-action="export-pdf" data-id="' + esc(recipe.id) + '">' + Icons.download + ' Esporta PDF</button>' +
        '<button type="button" class="btn btn--danger" data-action="delete-recipe" data-id="' + esc(recipe.id) + '">' + Icons.trash + ' Elimina</button>' +
      '</div>';

    // Dates
    html +=
      '<div class="recipe-detail__section recipe-detail__dates-row" style="font-size:.8rem;opacity:.6">' +
        '<p>Creata il ' + esc(Utils.formatDateTime(recipe.createdAt)) + '</p>' +
        (recipe.updatedAt && recipe.updatedAt !== recipe.createdAt
          ? '<p>Modificata il ' + esc(Utils.formatDateTime(recipe.updatedAt)) + '</p>'
          : '') +
      '</div>';

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

    html += '</div>';
    container.innerHTML = html;
  }

  /* ──────────────────── FAVORITES VIEW ──────────────────── */

  async function renderFavorites(container) {
    var recipes = await DB.getAllRecipes();
    var favs = recipes.filter(function (r) { return r.isFavorite; });

    var html = '<div class="view animate-fade-in">';
    html += '<div class="view-header"><h1 class="view-header__title">I Miei Preferiti</h1></div>';

    if (favs.length > 0) {
      html += recipeGridHTML(favs);
    } else {
      html += emptyStateHTML(Icons.heartCrack, 'Nessun preferito!', 'Tocca il cuore su una ricetta per aggiungerla qui', null, null);
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
      { id: 'classico', label: 'Classico', gradient: 'linear-gradient(135deg,#E85D3A,#FFA726)' },
      { id: 'oceano', label: 'Oceano', gradient: 'linear-gradient(135deg,#0EA5E9,#06B6D4)' },
      { id: 'bosco', label: 'Bosco', gradient: 'linear-gradient(135deg,#16A34A,#84CC16)' },
      { id: 'tramonto', label: 'Tramonto', gradient: 'linear-gradient(135deg,#A855F7,#EC4899)' },
      { id: 'ametista', label: 'Ametista', gradient: 'linear-gradient(135deg,#8B5CF6,#EC4899)' },
      { id: 'autunno', label: 'Autunno', gradient: 'linear-gradient(135deg,#8C5A3C,#D4A373)' },
      { id: 'zafferano', label: 'Zafferano', gradient: 'linear-gradient(135deg,#D97706,#FBBF24)' }
    ];

    var html = '<div class="view animate-fade-in">';
    html += '<div class="view-header"><h1 class="view-header__title">Impostazioni</h1></div>';

    // — CARD: Aspetto —
    html += '<div class="settings-card">';
    html += '<div class="settings-card__header"><span class="settings-card__icon">' + Icons.palette + '</span><h2 class="settings-card__title">Aspetto</h2></div>';
    html += '<div class="settings-card__body">';
    // Dark mode toggle
    html +=
      '<div class="settings-item">' +
        '<div class="settings-item__info">' +
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
      '<div class="settings-item settings-item--column">' +
        '<div class="settings-item__label">Palette colori</div>' +
        '<div class="theme-selector">';
    palettes.forEach(function (p) {
      html +=
        '<button type="button" class="theme-option' + (currentPalette === p.id ? ' active' : '') + '" data-action="set-palette" data-palette="' + esc(p.id) + '" aria-label="' + esc(p.label) + '">' +
          '<span class="theme-circle" style="background:' + p.gradient + '"></span>' +
          '<span class="theme-name">' + esc(p.label) + '</span>' +
        '</button>';
    });
    html += '</div></div>';
    html += '</div></div>'; // close body + card

    // — CARD: Gestione Categorie —
    html += '<div class="settings-card">';
    html += '<div class="settings-card__header"><span class="settings-card__icon">' + Icons.bookOpen + '</span><h2 class="settings-card__title">Gestione Categorie</h2></div>';
    html += '<div class="settings-card__body">';
    
    // Categorie personalizzate esistenti
    html += '<div class="settings-item settings-item--column">';
    html += '<div class="settings-item__label">Le tue categorie</div>';
    html += '<div class="custom-categories-list" style="display:flex; flex-wrap:wrap; gap:6px; margin: var(--space-sm) 0; width:100%;">';
    
    var customCats = Recipes.CATEGORIES.filter(function (cat) {
      return cat.isCustom;
    });
    
    if (customCats.length === 0) {
      html += '<p style="font-size:0.875rem; color:var(--text-muted); margin: 4px 0;">Non hai ancora creato categorie personalizzate.</p>';
    } else {
      customCats.forEach(function (cat) {
        html += '<div class="custom-cat-chip" style="display:inline-flex; align-items:center; gap:0.4rem; background:' + esc(cat.color) + '22; color:' + esc(cat.color) + '; border:1px solid ' + esc(cat.color) + '33; padding:6px 12px; border-radius:var(--radius-full); font-size:0.85rem; font-weight:600;">' +
                  '<span>' + esc(cat.icon) + ' ' + esc(cat.label) + '</span>' +
                  '<button type="button" class="btn-delete-cat" data-action="delete-category" data-id="' + esc(cat.id) + '" aria-label="Elimina categoria" style="cursor:pointer; display:inline-flex; align-items:center; border:none; background:transparent; color:' + esc(cat.color) + '; padding:0; margin-left:4px; opacity:0.8; transition:opacity var(--transition-fast);">' + Icons.x + '</button>' +
                '</div>';
      });
    }
    html += '</div></div>';

    // Form aggiungi categoria
    html += '<div class="settings-item settings-item--column">';
    html += '<div class="settings-item__label">Aggiungi nuova categoria</div>';
    html += '<div class="add-category-form" style="display:flex; flex-wrap:wrap; gap:var(--space-sm); width:100%; margin-top:var(--space-xs);">';
    html += '<input type="text" id="input-cat-label" class="form-input" placeholder="Es. Ricette Veloci" style="flex:1; min-width:150px; border:1px solid var(--border); padding:10px 14px; border-radius:var(--radius-sm); font-size:0.9rem;">';
    html += '<input type="text" id="input-cat-icon" class="form-input" placeholder="Emoji (es. ⏱️)" style="width:100px; border:1px solid var(--border); padding:10px 14px; border-radius:var(--radius-sm); font-size:0.9rem; text-align:center;">';
    html += '<select id="input-cat-color" class="form-select" style="width:120px; border:1px solid var(--border); padding:10px 14px; border-radius:var(--radius-sm); font-size:0.9rem; background-color:var(--bg-secondary);">' +
              '<option value="#E85D3A">Arancione</option>' +
              '<option value="#0EA5E9">Azzurro</option>' +
              '<option value="#16A34A">Verde</option>' +
              '<option value="#A855F7">Viola</option>' +
              '<option value="#EC4899">Rosa</option>' +
              '<option value="#FBBF24">Giallo</option>' +
            '</select>';
    html += '<button type="button" class="btn btn--secondary" data-action="add-category" style="padding:10px 20px; font-size:0.9rem; flex-shrink:0;">' + Icons.plus + ' Aggiungi</button>';
    html += '</div></div>';
    
    html += '</div></div>'; // close body + card

    // — CARD: Gestione Dati —
    html += '<div class="settings-card">';
    html += '<div class="settings-card__header"><span class="settings-card__icon">' + Icons.database + '</span><h2 class="settings-card__title">Gestione Dati</h2></div>';
    html += '<div class="settings-card__body">';
    html += '<div class="settings-warning-banner" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); color:var(--text-primary); padding:12px; border-radius:var(--radius-md); font-size:0.85rem; margin-bottom:var(--space-md); display:flex; gap:10px; align-items:flex-start;">' +
              '<span style="font-size:1.2rem; line-height:1;">⚠️</span>' +
              '<div>' +
                '<strong style="color:var(--text-primary); font-weight:700;">Nota sulla conservazione dei dati:</strong>' +
                '<p style="color:var(--text-secondary); margin-top:4px; line-height:1.4;">' +
                  'Le tue ricette sono salvate al 100% in locale sul browser. Se cancelli la cronologia di navigazione (compresi i cookie o i dati dei siti web), le ricette andranno perse definitivamente. Esporta regolarmente un **Backup JSON** per sicurezza.' +
                '</p>' +
              '</div>' +
            '</div>';
    html +=
      '<div class="settings-item">' +
        '<div class="settings-item__info">' +
          '<div class="settings-item__label">Ricette salvate</div>' +
          '<div class="settings-item__description"><strong>' + count + '</strong> ricett' + (count === 1 ? 'a' : 'e') + ' nel tuo ricettario</div>' +
        '</div>' +
      '</div>';
    html +=
      '<div class="settings-actions">' +
        '<button type="button" class="btn btn--secondary" data-action="export-pdf-all">' + Icons.download + ' Esporta PDF</button>' +
        '<button type="button" class="btn btn--secondary" data-action="export-data">' + Icons.download + ' Backup JSON</button>' +
        '<button type="button" class="btn btn--secondary" data-action="import-data">' + Icons.upload + ' Importa</button>' +
        '<input type="file" id="import-file-input" accept=".json,application/json" class="hidden">' +
      '</div>';
    html += '</div></div>';

    // — CARD: Informazioni —
    html += '<div class="settings-card">';
    html += '<div class="settings-card__header"><span class="settings-card__icon">' + Icons.infoCircle + '</span><h2 class="settings-card__title">Informazioni</h2></div>';
    html += '<div class="settings-card__body">';
    html +=
      '<div class="settings-item">' +
        '<div class="settings-item__info">' +
          '<div class="settings-item__label">Versione</div>' +
          '<div class="settings-item__description">1.0.0</div>' +
        '</div>' +
      '</div>';
    html +=
      '<div class="settings-item">' +
        '<div class="settings-item__info">' +
          '<div class="settings-item__label">Sapori</div>' +
          '<div class="settings-item__description">Il tuo ricettario personale</div>' +
        '</div>' +
      '</div>';
    html +=
      '<div class="settings-item">' +
        '<div class="settings-item__info">' +
          '<div class="settings-item__label">' + Icons.shield + ' Privacy</div>' +
          '<div class="settings-item__description">I tuoi dati sono salvati localmente sul dispositivo</div>' +
        '</div>' +
      '</div>';
    html += '</div></div>';

    // Footer
    html += '<div class="settings-footer"><p>Creato con cura in Italia</p></div>';
    html += '</div>';

    container.innerHTML = html;
  }

  /* ──────────────────── MODAL ──────────────────── */

  /* ──────────────────── PANTRY / SVUOTAFRIGO VIEW ──────────────────── */

  async function renderPantry(container, userIngredients) {
    userIngredients = userIngredients || [];
    var esc = Utils.escapeHtml;
    var recipes = await DB.getAllRecipes();
    var matches = Recipes.matchPantry(recipes, userIngredients);

    var html = '<div class="view pantry-view animate-fade-in" style="padding-bottom:2rem">';
    
    // Header
    html += '<div class="view-header" style="display:flex;align-items:center;gap:.75rem;margin-bottom:1.25rem">';
    html += '<button type="button" class="btn btn--icon" data-action="go-home" aria-label="Torna indietro" style="border:1px solid var(--border);background:var(--glass-bg);width:40px;height:40px;border-radius:var(--radius-full);display:flex;align-items:center;justify-content:center;">' + Icons.arrowLeft + '</button>';
    html += '<div><h1 class="view-header__title" style="margin:0;font-size:1.5rem">👨‍🍳 Modalità Svuotafrigo</h1>';
    html += '<p style="margin:0;font-size:.85rem;color:var(--text-muted)">Inserisci gli ingredienti che hai in casa per scoprire cosa cucinare</p></div></div>';

    // Input form for ingredients
    html += '<div class="pantry-card" style="background:var(--surface-card);border:1px solid var(--border-color);border-radius:var(--radius-lg);padding:1.25rem;margin-bottom:1.5rem">';
    html += '<form id="pantry-form" style="display:flex;gap:.5rem;margin-bottom:1rem">';
    html += '<input type="text" id="pantry-input" class="form-input" placeholder="Es. uova, guanciale, mascarpone..." style="flex:1" autocomplete="off">';
    html += '<button type="submit" class="btn btn--primary" data-action="add-pantry-ingredient">' + Icons.plus + ' Aggiungi</button>';
    html += '</form>';

    // Quick suggestions
    var quicks = ['Uova', 'Farina', 'Latte', 'Pomodoro', 'Burro', 'Pasta', 'Riso', 'Carne', 'Zucchine', 'Patate', 'Formaggio', 'Olio'];
    html += '<div style="margin-bottom:1rem"><span style="font-size:.75rem;color:var(--text-muted);display:block;margin-bottom:.4rem;text-transform:uppercase;letter-spacing:.05em">Suggerimenti rapidi:</span>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:.4rem">';
    quicks.forEach(function(q) {
      var isAdded = userIngredients.some(function(u){ return u.toLowerCase() === q.toLowerCase(); });
      if (!isAdded) {
        html += '<button type="button" class="btn btn--ghost btn--small" data-action="add-quick-pantry" data-ingredient="' + esc(q) + '" style="font-size:.78rem;padding:4px 10px;border-radius:99px">+ ' + esc(q) + '</button>';
      }
    });
    html += '</div></div>';

    // Selected ingredient chips
    if (userIngredients.length > 0) {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">';
      html += '<span style="font-size:.85rem;font-weight:600">Ingredienti selezionati (' + userIngredients.length + '):</span>';
      html += '<button type="button" class="btn btn--ghost btn--small" data-action="clear-pantry" style="color:var(--error-color);font-size:.78rem">Pulisci tutti</button>';
      html += '</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:.5rem">';
      userIngredients.forEach(function(ing, idx) {
        html += '<span class="pantry-chip" style="background:var(--primary-color);color:#fff;padding:6px 12px;border-radius:99px;font-size:.85rem;font-weight:500;display:inline-flex;align-items:center;gap:.4rem">';
        html += esc(ing);
        html += '<button type="button" data-action="remove-pantry-ingredient" data-index="' + idx + '" aria-label="Rimuovi" style="background:none;border:none;color:#fff;cursor:pointer;padding:0;display:flex;align-items:center">' + Icons.x + '</button>';
        html += '</span>';
      });
      html += '</div>';
    } else {
      html += '<div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:.85rem;font-style:italic">Nessun ingrediente inserito. Aggiungine uno per iniziare la ricerca!</div>';
    }

    html += '</div>'; // close pantry-card

    // Results section
    if (userIngredients.length === 0) {
      html += emptyStateHTML(Icons.searchLg, 'Svuota la tua dispensa!', 'Aggiungi gli ingredienti che hai a disposizione per trovare ricette gustose', null, null);
    } else if (matches.length === 0) {
      html += emptyStateHTML(Icons.frown, 'Nessuna ricetta trovata', 'Nessuna ricetta nel tuo ricettario contiene gli ingredienti selezionati', null, null);
    } else {
      var complete = matches.filter(function(m){ return m.isComplete; });
      var partial = matches.filter(function(m){ return !m.isComplete; });

      html += '<div class="pantry-results">';

      if (complete.length > 0) {
        html += '<h2 style="font-size:1.1rem;font-weight:700;color:var(--success-color);margin-bottom:.75rem;display:flex;align-items:center;gap:.4rem">🟢 Pronti da cucinare (Hai tutti gli ingredienti - ' + complete.length + ')</h2>';
        html += '<div class="recipe-grid" style="margin-bottom:1.5rem">';
        complete.forEach(function(m) {
          html += pantryCardHTML(m);
        });
        html += '</div>';
      }

      if (partial.length > 0) {
        html += '<h2 style="font-size:1.1rem;font-weight:700;color:var(--warning-color);margin-bottom:.75rem;display:flex;align-items:center;gap:.4rem">🟡 Ti manca pochissimo (' + partial.length + ')</h2>';
        html += '<div class="recipe-grid">';
        partial.forEach(function(m) {
          html += pantryCardHTML(m);
        });
        html += '</div>';
      }

      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  function pantryCardHTML(matchItem) {
    var esc = Utils.escapeHtml;
    var r = matchItem.recipe;
    var cat = Utils.getCategoryInfo(r.category);
    var badgeColor = matchItem.isComplete ? '#10B981' : '#F59E0B';
    var badgeText = matchItem.isComplete 
      ? '🟢 100% Ingredienti' 
      : '🟡 ' + matchItem.matchedCount + ' su ' + matchItem.totalCount + ' ingredienti';

    var html = '<div class="recipe-card animate-fade-in" data-id="' + esc(r.id) + '">';
    html += '<div class="recipe-card__body">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;margin-bottom:.4rem">';
    html += '<span class="recipe-card__category" style="background:' + esc(cat.color) + '22;color:' + esc(cat.color) + '">' + esc(cat.icon) + ' ' + esc(cat.label) + '</span>';
    html += '<span style="background:' + badgeColor + '22;color:' + badgeColor + ';font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:99px">' + esc(badgeText) + '</span>';
    html += '</div>';

    html += '<h3 class="recipe-card__title" style="margin-bottom:.4rem">' + esc(r.name) + '</h3>';

    if (matchItem.missingNames.length > 0) {
      html += '<div style="font-size:.75rem;color:var(--error-color);margin-bottom:.6rem"><strong>Mancano:</strong> ' + esc(matchItem.missingNames.join(', ')) + '</div>';
    } else {
      html += '<div style="font-size:.75rem;color:var(--success-color);margin-bottom:.6rem"><strong>Includi:</strong> ' + esc(matchItem.matchedNames.join(', ')) + '</div>';
    }

    html += '<button type="button" class="btn btn--primary btn--small" data-action="open-recipe" data-id="' + esc(r.id) + '" style="width:100%">Vedi Ricetta</button>';
    html += '</div></div>';
    return html;
  }

  function showCookingModal(recipe, stepIndex, checkedIngredients, wakeLockActive, timerState, ingExpanded) {
    stepIndex = stepIndex || 0;
    checkedIngredients = checkedIngredients || {};
    if (typeof ingExpanded === 'undefined') ingExpanded = true;
    var esc = Utils.escapeHtml;
    var overlay = document.getElementById('modal-overlay');
    var totalSteps = (recipe.steps && recipe.steps.length) || 0;
    var isFinished = stepIndex >= totalSteps;

    var stepVal = (recipe.steps && recipe.steps[stepIndex]) || '';
    var stepText = typeof stepVal === 'object' ? stepVal.text : stepVal;
    var stepNotes = typeof stepVal === 'object' ? stepVal.notes : '';

    // Progress
    var pct = totalSteps > 0 ? Math.round((stepIndex / totalSteps) * 100) : 0;
    var checkedCount = Object.values(checkedIngredients).filter(Boolean).length;
    var totalIng = (recipe.ingredients && recipe.ingredients.length) || 0;

    // Timer state
    timerState = timerState || { minutes: 0, seconds: 0, running: false, totalSeconds: 0 };
    var timerDisplay = (isNaN(timerState.minutes) ? '00' : String(timerState.minutes).padStart(2,'0')) +
                       ':' +
                       (isNaN(timerState.seconds) ? '00' : String(timerState.seconds).padStart(2,'0'));
    var timerClass = timerState.running
      ? (timerState.minutes === 0 && timerState.seconds <= 10 ? 'cooking-modal__timer-display--danger' :
         timerState.minutes === 0 && timerState.seconds <= 30 ? 'cooking-modal__timer-display--warning' :
         'cooking-modal__timer-display--running')
      : '';

    var html = '<div class="cooking-modal" id="cooking-modal-inner">';

    // Accent bar
    html += '<div class="cooking-modal__accent-bar"></div>';

    // ── Header ──
    var wlClass = wakeLockActive ? 'cooking-modal__wakelock--active' : 'cooking-modal__wakelock--inactive';
    var wlText  = wakeLockActive ? '⚡ Schermo attivo' : '📱 Standard';
    html += '<div class="cooking-modal__header">';
    html +=   '<div class="cooking-modal__header-left">';
    html +=     '<span class="cooking-modal__label">👨‍🍳 Modalità Cucina</span>';
    html +=     '<h2 class="cooking-modal__title">' + esc(recipe.name) + '</h2>';
    html +=   '</div>';
    html +=   '<div class="cooking-modal__header-right">';
    html +=     '<span class="cooking-modal__wakelock ' + wlClass + '">' + wlText + '</span>';
    html +=     '<button type="button" class="cooking-modal__close" data-action="close-cooking" aria-label="Chiudi Modalità Cucina">' + Icons.x + '</button>';
    html +=   '</div>';
    html += '</div>';

    if (!isFinished) {
      // ── Progress bar ──
      html += '<div class="cooking-modal__progress-wrap">';
      html +=   '<div class="cooking-modal__progress-info">';
      html +=     '<span class="cooking-modal__step-counter">Passaggio ' + (stepIndex + 1) + ' di ' + totalSteps + '</span>';
      html +=     '<span class="cooking-modal__progress-pct">' + pct + '%</span>';
      html +=   '</div>';
      html +=   '<div class="cooking-modal__progress-bar-bg">';
      html +=     '<div class="cooking-modal__progress-bar-fill" style="width:' + pct + '%"></div>';
      html +=   '</div>';
      html += '</div>';

      // ── Step dots ──
      if (totalSteps <= 20) {
        html += '<div class="cooking-modal__dots">';
        for (var d = 0; d < totalSteps; d++) {
          var dotClass = d < stepIndex ? 'cooking-modal__dot cooking-modal__dot--done' :
                         d === stepIndex ? 'cooking-modal__dot cooking-modal__dot--active' :
                         'cooking-modal__dot';
          var dotContent = d < stepIndex ? '✓' : (d + 1);
          html += '<button type="button" class="' + dotClass + '" data-action="cooking-goto" data-step="' + d + '" aria-label="Vai al passaggio ' + (d+1) + '">' + dotContent + '</button>';
        }
        html += '</div>';
      }

      // ── Scrollable body ──
      html += '<div class="cooking-modal__body">';

      // Step card
      html += '<div class="cooking-modal__step-card">';
      html +=   '<span class="cooking-modal__step-badge">🔥 Passaggio ' + (stepIndex + 1) + ' / ' + totalSteps + '</span>';
      html +=   '<p class="cooking-modal__step-text">' + esc(stepText) + '</p>';
      if (stepNotes) {
        html += '<div class="cooking-modal__step-notes"><strong>💡 Nota:</strong>&nbsp;' + esc(stepNotes) + '</div>';
      }
      html += '</div>';

      // Ingredients panel
      if (totalIng > 0) {
        var ingListClass = 'cooking-modal__ing-list' + (ingExpanded ? '' : ' cooking-modal__ing-list--collapsed');
        var toggleClass  = 'cooking-modal__ing-toggle' + (ingExpanded ? ' cooking-modal__ing-toggle--open' : '');
        var ingPct = totalIng > 0 ? checkedCount + '/' + totalIng : '';

        html += '<div class="cooking-modal__ing-panel">';
        html +=   '<div class="cooking-modal__ing-header" data-action="toggle-cooking-ing-panel">';
        html +=     '<span class="cooking-modal__ing-title">🛒 Ingredienti';
        if (ingPct) html += '&nbsp;<span class="cooking-modal__ing-progress">' + ingPct + ' ✓</span>';
        html +=     '</span>';
        html +=     '<span class="' + toggleClass + '">▼</span>';
        html +=   '</div>';
        html +=   '<div class="' + ingListClass + '" id="cooking-ing-list">';
        recipe.ingredients.forEach(function(ing, idx) {
          var isChecked = !!checkedIngredients[idx];
          var chipClass = 'cooking-modal__ing-chip' + (isChecked ? ' cooking-modal__ing-chip--checked' : '');
          var parts = [];
          if (ing.quantity) parts.push(esc(ing.quantity));
          if (ing.unit) parts.push(esc(ing.unit));
          parts.push(esc(ing.name));
          html += '<button type="button" class="' + chipClass + '" data-action="toggle-cooking-ing" data-index="' + idx + '">';
          html +=   '<span class="ing-chip-check">' + (isChecked ? '✓' : '○') + '</span>';
          html +=   parts.join(' ');
          html += '</button>';
        });
        html += '</div>';
        html += '</div>';
      }

      // Timer
      html += '<div class="cooking-modal__timer">';
      html +=   '<div>';
      html +=     '<div class="cooking-modal__timer-label">⏱ Timer</div>';
      html +=     '<div class="cooking-modal__timer-display ' + timerClass + '" id="cooking-timer-display">' + timerDisplay + '</div>';
      html +=   '</div>';
      html +=   '<div style="display:flex;flex-direction:column;align-items:center;gap:6px">';
      html +=     '<div class="cooking-modal__timer-input-wrap">';
      html +=       '<input type="number" class="cooking-modal__timer-input" id="cooking-timer-min" min="0" max="99" value="' + (timerState.minutes || 0) + '" aria-label="Minuti">';
      html +=       '<span style="font-weight:700;color:var(--text-muted)">:</span>';
      html +=       '<input type="number" class="cooking-modal__timer-input" id="cooking-timer-sec" min="0" max="59" value="' + (timerState.seconds || 0) + '" aria-label="Secondi">';
      html +=     '</div>';
      html +=     '<div class="cooking-modal__timer-controls">';
      if (timerState.running) {
        html +=   '<button type="button" class="cooking-modal__timer-btn" data-action="cooking-timer-pause" aria-label="Pausa timer">⏸</button>';
      } else {
        html +=   '<button type="button" class="cooking-modal__timer-btn cooking-modal__timer-btn--start" data-action="cooking-timer-start" aria-label="Avvia timer">▶</button>';
      }
      html +=     '<button type="button" class="cooking-modal__timer-btn" data-action="cooking-timer-reset" aria-label="Azzera timer">↺</button>';
      html +=     '</div>';
      html +=   '</div>';
      html += '</div>';

      // Swipe hint (only mobile)
      html += '<div class="cooking-modal__swipe-hint">← scorri per cambiare passaggio →</div>';

      html += '</div>'; // .cooking-modal__body

      // ── Footer nav ──
      html += '<div class="cooking-modal__footer">';
      var prevDisabled = stepIndex === 0 ? ' disabled' : '';
      var nextLabel = stepIndex >= totalSteps - 1 ? '🏁 Fine!' : 'Avanti →';
      var nextClass = 'cooking-modal__nav-btn cooking-modal__nav-btn--primary';
      html += '<button type="button" class="cooking-modal__nav-btn" data-action="cooking-prev" data-step="' + (stepIndex - 1) + '"' + prevDisabled + '>← Indietro</button>';
      html += '<button type="button" class="' + nextClass + '" data-action="cooking-next" data-step="' + (stepIndex + 1) + '">' + nextLabel + '</button>';
      html += '</div>';

    } else {
      // ── Finish screen ──
      html += '<div class="cooking-modal__finish">';
      html +=   '<div class="cooking-modal__finish-emoji">🎉</div>';
      html +=   '<h2 class="cooking-modal__finish-title">Buon appetito!</h2>';
      html +=   '<p class="cooking-modal__finish-subtitle">' + esc(recipe.name) + ' è pronto!</p>';
      html +=   '<button type="button" class="cooking-modal__nav-btn cooking-modal__nav-btn--primary" data-action="close-cooking" style="max-width:260px;margin-top:8px">✓ Chiudi</button>';
      html +=   '<button type="button" class="cooking-modal__nav-btn" data-action="cooking-prev" data-step="' + (totalSteps - 1) + '" style="max-width:260px">← Torna all\'ultimo passaggio</button>';
      html += '</div>';
    }

    html += '</div>'; // .cooking-modal

    overlay.innerHTML = html;
    overlay.classList.remove('hidden');

    // ── Touch swipe gesture (mobile) ──
    var modal = document.getElementById('cooking-modal-inner');
    if (modal) {
      var touchStartX = 0;
      var touchStartY = 0;
      modal.addEventListener('touchstart', function(e) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });
      modal.addEventListener('touchend', function(e) {
        var dx = e.changedTouches[0].clientX - touchStartX;
        var dy = e.changedTouches[0].clientY - touchStartY;
        // Only fire if horizontal swipe is dominant and significant
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          var swipeBtn = document.querySelector(dx < 0 ? '[data-action="cooking-next"]' : '[data-action="cooking-prev"]');
          if (swipeBtn && !swipeBtn.disabled) swipeBtn.click();
        }
      }, { passive: true });
    }
  }

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

  /**
   * Show a full Print Preview Modal for a single recipe
   * @param {Object} recipe
   */
  function showPrintPreviewModal(recipe) {
    var esc = Utils.escapeHtml;
    var overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    var cat = Utils.getCategoryInfo(recipe.category);
    var diffEmoji = Utils.getDifficultyEmoji(recipe.difficulty);
    var diffMap = { facile: 'Facile', media: 'Media', difficile: 'Difficile' };
    var diffLabel = diffMap[recipe.difficulty] || 'Facile';
    var today = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    var pwaUrl = window.location.origin + window.location.pathname;

    // ── Ingredients HTML ──
    var ingHtml = '';
    if (recipe.ingredients && recipe.ingredients.length > 0) {
      recipe.ingredients.forEach(function (ing) {
        var qtyStr = ing.quantity ? esc(ing.quantity) + (ing.unit ? ' ' + esc(ing.unit) : '') : '';
        var qtyPart = qtyStr ? '<span class="ingredient-item__qty">' + qtyStr + '</span>' : '';
        var namePart = '<span class="ingredient-item__name">' + esc(ing.name) + '</span>';
        var notesHTML = ing.notes ? '<span class="ingredient-item__notes">💡 ' + esc(ing.notes) + '</span>' : '';

        ingHtml +=
          '<li class="ingredient-item print-preview__ing-item">' +
            '<span class="ingredient-bullet print-preview__ing-bullet">•</span>' +
            '<div class="ingredient-item__body">' +
              '<div class="ingredient-item__main">' +
                namePart + (qtyPart ? ' ' + qtyPart : '') +
              '</div>' +
              notesHTML +
            '</div>' +
          '</li>';
      });
    } else {
      ingHtml = '<li style="color:#999;font-size:10pt;padding:6px 0">Nessun ingrediente inserito.</li>';
    }

    // ── Steps HTML ──
    var stepsHtml = '';
    if (recipe.steps && recipe.steps.length > 0) {
      recipe.steps.forEach(function (s, i) {
        var text = typeof s === 'object' ? s.text : s;
        var notes = typeof s === 'object' ? s.notes : '';
        stepsHtml +=
          '<li class="print-preview__step-item">' +
            '<span class="print-preview__step-num">' + (i + 1) + '</span>' +
            '<div>' +
              '<span class="print-preview__step-text">' + esc(text) + '</span>' +
              (notes ? '<em class="print-preview__step-notes">📌 ' + esc(notes) + '</em>' : '') +
            '</div>' +
          '</li>';
      });
    } else {
      stepsHtml = '<li style="color:#999;font-size:10pt;padding:6px 0">Nessun passaggio inserito.</li>';
    }

    // ── Notes HTML ──
    var notesHtml = recipe.notes
      ? '<div class="print-preview__notes-box"><div class="print-preview__notes-label">📝 Note</div><div class="print-preview__notes-text">' + esc(recipe.notes) + '</div></div>'
      : '<div class="print-preview__notes-box"><div class="print-preview__notes-label">📝 Note</div><div class="print-preview__dotted-line" style="margin:8px 0"></div><div class="print-preview__dotted-line" style="margin:8px 0"></div><div class="print-preview__dotted-line" style="margin:8px 0"></div></div>';

    // ── Description HTML ──
    var descHtml = recipe.description
      ? '<div style="margin-bottom:0.4cm"><div class="print-preview__section-title" style="margin-top:0.3cm">Descrizione</div><p style="font-size:10.5pt;color:#1a0f0a;line-height:1.6;margin:0">' + esc(recipe.description) + '</p></div>'
      : '';

    // ── Photo HTML ──
    var photoHtml = recipe.image
      ? '<img src="' + esc(recipe.image) + '" alt="Foto" style="width:100%;height:100%;object-fit:cover">'
      : '<span class="print-preview__photo-placeholder">FOTO</span>';

    overlay.innerHTML =
      '<div class="print-preview-modal">' +
        // ── HEADER ──
        '<div class="print-preview-modal__header">' +
          '<div class="print-preview-modal__header-left">' +
            '<span class="print-preview-modal__label">🖨️ Anteprima Stampa</span>' +
            '<h2 class="print-preview-modal__title">' + esc(recipe.name) + '</h2>' +
          '</div>' +
          '<div class="print-preview-modal__header-actions">' +
            '<button type="button" class="btn btn--primary" id="btn-print-now" style="display:flex;align-items:center;gap:6px">' +
              '🖨️ <span>Stampa / Salva PDF</span>' +
            '</button>' +
            '<button type="button" class="btn btn--icon" data-action="modal-cancel" style="border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +

        // ── PAPER PREVIEW ──
        '<div class="print-preview-modal__body">' +
          '<div class="print-preview-modal__paper">' +
            // Color accent band
            '<div class="print-preview__accent"></div>' +

            // Header row: watermark
            '<div class="print-preview__header">' +
              '<span></span>' +
              '<span class="print-preview__watermark">🍴 SAPORI</span>' +
            '</div>' +

            // Title
            '<div class="print-preview__title">' + esc(recipe.name) + '</div>' +

            // Category pill
            '<div class="print-preview__cat">' + esc(cat.icon) + ' ' + esc(cat.label) + '</div>' +

            // Info row
            '<div class="print-preview__info">' +
              '<div class="print-preview__info-item"><span class="print-preview__info-label">Prep</span> ' + esc(Utils.formatTime(recipe.prepTime || 0)) + '</div>' +
              '<div class="print-preview__info-item"><span class="print-preview__info-label">Cottura</span> ' + esc(Utils.formatTime(recipe.cookTime || 0)) + '</div>' +
              '<div class="print-preview__info-item"><span class="print-preview__info-label">Porzioni</span> ' + esc(String(recipe.servings || 4)) + '</div>' +
              '<div class="print-preview__info-item"><span class="print-preview__info-label">Difficoltà</span> ' + esc(diffEmoji) + ' ' + esc(diffLabel) + '</div>' +
            '</div>' +

            // Description
            descHtml +

            // Notes box
            notesHtml +

            // Ingredients
            '<div class="print-preview__section-title">Ingredienti</div>' +
            '<ul class="print-preview__ing-list">' + ingHtml + '</ul>' +

            // Steps
            '<div class="print-preview__section-title">Preparazione</div>' +
            '<ol class="print-preview__step-list">' + stepsHtml + '</ol>' +

            // Footer: photo + storage
            '<div class="print-preview__footer-box">' +
              '<div class="print-preview__photo-box">' + photoHtml + '</div>' +
              '<div class="print-preview__storage-box">' +
                '<div class="print-preview__storage-label">🏷️ Conservazione:</div>' +
                '<div class="print-preview__dotted-line"></div>' +
                '<div class="print-preview__dotted-line"></div>' +
                '<div class="print-preview__dotted-line"></div>' +
              '</div>' +
            '</div>' +

            // Document footer
            '<div class="print-preview__doc-footer">' +
              '<span>Creato con Sapori App — ' + today + '</span>' +
              '<span style="color:#E85D3A">' + esc(pwaUrl) + '</span>' +
            '</div>' +
          '</div>' + // paper
        '</div>' + // body

        // ── FOOTER BAR ──
        '<div class="print-preview-modal__footer">' +
          '<span class="print-preview-modal__tip">💡 Suggerimento: nel dialogo di stampa seleziona <strong>Salva come PDF</strong> per creare il file</span>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-action="modal-cancel">Chiudi</button>' +
        '</div>' +
      '</div>';

    overlay.classList.remove('hidden');

    // Print button
    var btnPrint = document.getElementById('btn-print-now');
    if (btnPrint) {
      btnPrint.addEventListener('click', function () {
        window.print();
      });
    }
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
    renderPantry: renderPantry,
    showCookingModal: showCookingModal,
    showConfirmModal: showConfirmModal,
    showPrintPreviewModal: showPrintPreviewModal,
    hideModal: hideModal
  };

})();
