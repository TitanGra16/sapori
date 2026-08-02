/**
 * Presentazione e lettura dell'archivio locale delle bozze.
 *
 * Il modulo non modifica i record: app.js resta responsabile delle azioni
 * distruttive e verifica sempre di nuovo la revisione prima di procedere.
 */
(function (global) {
  'use strict';

  var SAFE_TOKEN = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

  function isPlainObject(value) {
    return Boolean(value) &&
      Object.prototype.toString.call(value) === '[object Object]';
  }

  function safeToken(value) {
    var token = typeof value === 'string' ? value.trim() : '';
    return SAFE_TOKEN.test(token) ? token : null;
  }

  function safeRevision(value) {
    var revision = Number(value);
    return Number.isInteger(revision) && revision > 0 ? revision : null;
  }

  function cleanName(value) {
    var name = typeof value === 'string' ? value.trim() : '';
    return name ? name.slice(0, 120) : '';
  }

  function safeName(record, fallbackRecipe) {
    var data = isPlainObject(record && record.data) ? record.data : null;
    var recipe = data && isPlainObject(data.recipe) ? data.recipe : null;
    var name = cleanName(recipe && recipe.name);
    if (name) return name;
    var fallbackName = cleanName(fallbackRecipe && fallbackRecipe.name);
    if (fallbackName) return fallbackName;
    return record && record.mode === 'edit'
      ? 'Modifica senza titolo'
      : 'Nuova ricetta senza titolo';
  }

  function recipeIdFromDraft(record) {
    var data = isPlainObject(record && record.data) ? record.data : null;
    var recipe = data && isPlainObject(data.recipe) ? data.recipe : null;
    return safeToken(recipe && recipe.id);
  }

  function normalizeRecord(record, baseRecipe) {
    if (
      global.DraftSchema &&
      typeof global.DraftSchema.tryNormalize === 'function'
    ) {
      return global.DraftSchema.tryNormalize(record.data, {
        mode: record.mode,
        baseRecipe: baseRecipe || null
      });
    }
    return {
      valid: true,
      data: isPlainObject(record.data) ? record.data : { recipe: {} },
      error: null
    };
  }

  function savedRecipesById(recipes) {
    var byId = new Map();
    (Array.isArray(recipes) ? recipes : []).forEach(function (recipe) {
      var id = safeToken(recipe && recipe.id);
      if (id) byId.set(id, recipe);
    });
    return byId;
  }

  function compareWithSavedSummary(draftRecipe, savedRecipe) {
    if (
      !isPlainObject(draftRecipe) ||
      !isPlainObject(savedRecipe) ||
      !global.DraftIdentity ||
      typeof global.DraftIdentity.sameContent !== 'function'
    ) {
      return 'different';
    }
    if (!global.DraftIdentity.sameContent(draftRecipe, savedRecipe)) {
      return 'different';
    }
    // getRecipeSummaries non espone la foto completa. Se una delle versioni
    // ha una foto, app.js esegue il confronto esatto prima di rimuovere.
    if (draftRecipe.image || savedRecipe.hasImage) return 'photo-check';
    return 'same';
  }

  function describe(records, recipes) {
    var existingRecipes = savedRecipesById(recipes);
    return (Array.isArray(records) ? records : []).reduce(function (items, record) {
      if (!record || (record.mode !== 'create' && record.mode !== 'edit')) {
        return items;
      }
      var draftId = safeToken(record.draftId);
      var recipeId = record.mode === 'edit'
        ? safeToken(record.recipeId)
        : null;
      var revision = safeRevision(record.revision);
      if (!draftId || !revision || (record.mode === 'edit' && !recipeId)) {
        return items;
      }

      var baseRecipe = existingRecipes.get(recipeId) || null;
      var normalized = normalizeRecord(record, baseRecipe);
      var normalizedRecord = normalized.valid
        ? Object.assign({}, record, { data: normalized.data })
        : record;
      var normalizedRecipe = normalized.valid &&
        normalized.data &&
        isPlainObject(normalized.data.recipe)
        ? normalized.data.recipe
        : null;
      var savedId = record.mode === 'create' && normalized.valid
        ? recipeIdFromDraft(normalizedRecord)
        : null;
      var status = normalized.valid ? 'active' : 'unreadable';
      if (
        normalized.valid &&
        record.mode === 'create' &&
        savedId &&
        existingRecipes.has(savedId)
      ) {
        var summaryComparison = compareWithSavedSummary(
          normalizedRecipe,
          existingRecipes.get(savedId)
        );
        status = summaryComparison === 'same'
          ? 'already-saved'
          : summaryComparison === 'photo-check'
            ? 'photo-check'
            : 'identity-conflict';
      } else if (
        normalized.valid &&
        record.mode === 'edit' &&
        !existingRecipes.has(recipeId)
      ) {
        status = 'orphaned';
      }

      var updatedAt = Number(record.updatedAt);
      items.push({
        mode: record.mode,
        recipeId: recipeId,
        draftId: draftId,
        revision: revision,
        name: normalized.valid
          ? safeName(normalizedRecord, baseRecipe)
          : 'Bozza non leggibile',
        updatedAt: Number.isFinite(updatedAt) && updatedAt > 0
          ? updatedAt
          : null,
        status: status,
        savedRecipeId: status === 'already-saved' ? savedId : null,
        readable: normalized.valid
      });
      return items;
    }, []);
  }

  async function load(recipes) {
    if (!global.DraftStore || typeof global.DraftStore.list !== 'function') {
      throw new Error('Archivio bozze non disponibile');
    }
    var recipeList = Array.isArray(recipes)
      ? recipes
      : await global.DB.getRecipeSummaries();
    var records = await global.DraftStore.list();
    return describe(records, recipeList);
  }

  function routeFor(item) {
    if (!item) return '#drafts';
    if (item.mode === 'edit') {
      return '#edit/' + encodeURIComponent(item.recipeId) + '/' +
        encodeURIComponent(item.draftId);
    }
    return '#create/' + encodeURIComponent(item.draftId);
  }

  function formatUpdatedAt(value) {
    if (
      value === null ||
      value === undefined ||
      !Number.isFinite(Number(value)) ||
      Number(value) <= 0
    ) {
      return 'Data non disponibile';
    }
    return new Date(Number(value)).toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function targetAttributes(item) {
    var esc = global.Utils.escapeHtml;
    return ' data-draft-mode="' + esc(item.mode) + '"' +
      ' data-draft-id="' + esc(item.draftId) + '"' +
      ' data-draft-revision="' + esc(String(item.revision)) + '"' +
      (item.recipeId
        ? ' data-recipe-id="' + esc(item.recipeId) + '"'
        : '') +
      (item.savedRecipeId
        ? ' data-saved-recipe-id="' + esc(item.savedRecipeId) + '"'
        : '');
  }

  function statusCopy(item) {
    if (item.status === 'unreadable') {
      return {
        badge: 'Da controllare',
        message: 'Il contenuto non è leggibile. La bozza è stata preservata: puoi eliminarla oppure riprovare più tardi.',
        action: null
      };
    }
    if (item.status === 'already-saved') {
      return {
        badge: 'Già salvata',
        message: 'La ricetta è già nel ricettario. Puoi aprirla e rimuovere questa bozza residua.',
        action: 'Apri ricetta'
      };
    }
    if (item.status === 'identity-conflict') {
      return {
        badge: 'Copia separata',
        message: 'Esiste già una ricetta con lo stesso identificatore, ma il contenuto è diverso.',
        action: 'Apri come nuova'
      };
    }
    if (item.status === 'photo-check') {
      return {
        badge: 'Foto da verificare',
        message: 'Il testo coincide con una ricetta salvata. Apri la bozza per confrontare anche la foto completa in sicurezza.',
        action: 'Verifica ricetta'
      };
    }
    if (item.status === 'orphaned') {
      return {
        badge: 'Da recuperare',
        message: 'La ricetta originale non esiste più. Puoi recuperare questa bozza come nuova ricetta.',
        action: 'Recupera come nuova'
      };
    }
    return item.mode === 'edit'
      ? {
          badge: 'Modifica',
          message: 'Modifiche non ancora registrate nella ricetta salvata.',
          action: 'Continua modifica'
        }
      : {
          badge: 'Nuova',
          message: 'Nuova ricetta non ancora aggiunta al ricettario.',
          action: 'Continua ricetta'
        };
  }

  function homeSummaryHTML(items) {
    if (!Array.isArray(items) || items.length === 0) return '';
    var esc = global.Utils.escapeHtml;
    var latest = items[0];
    var count = items.length;
    var latestCopy = statusCopy(latest);
    return (
      '<section class="draft-home-summary" aria-labelledby="draft-home-summary-title">' +
        '<div class="draft-home-summary__icon">' + global.Icons.edit + '</div>' +
        '<div class="draft-home-summary__copy">' +
          '<h2 id="draft-home-summary-title">' +
            (count === 1 ? 'Hai una bozza locale' : 'Hai ' + count + ' bozze locali') +
          '</h2>' +
          '<p>La più recente è <strong>' + esc(latest.name) + '</strong>, aggiornata ' +
            esc(formatUpdatedAt(latest.updatedAt)) + '.</p>' +
        '</div>' +
        '<div class="draft-home-summary__actions">' +
          (latestCopy.action
            ? '<button type="button" class="btn btn--primary btn--small" data-action="resume-draft"' +
                targetAttributes(latest) + ' aria-label="' +
                esc(latestCopy.action + ' ' + latest.name) + '">' +
                esc(latestCopy.action) + '</button>'
            : '') +
          '<button type="button" class="btn btn--ghost btn--small" data-action="open-drafts">' +
            'Gestisci tutte' +
          '</button>' +
        '</div>' +
      '</section>'
    );
  }

  function cardHTML(item) {
    var esc = global.Utils.escapeHtml;
    var copy = statusCopy(item);
    var updatedText = formatUpdatedAt(item.updatedAt);
    var headingId = 'draft-title-' + item.mode + '-' + item.draftId;
    var datetime = item.updatedAt
      ? new Date(item.updatedAt).toISOString()
      : '';
    return (
      '<li class="draft-library-item">' +
      '<article class="draft-card draft-card--' + esc(item.status) +
        '" aria-labelledby="' + esc(headingId) + '">' +
        '<div class="draft-card__body">' +
          '<div class="draft-card__heading">' +
            '<span class="draft-card__badge">' + esc(copy.badge) + '</span>' +
            '<h2 id="' + esc(headingId) + '">' + esc(item.name) + '</h2>' +
          '</div>' +
          '<p class="draft-card__message">' + esc(copy.message) + '</p>' +
          '<p class="draft-card__time">' + global.Icons.clock +
            (datetime
              ? '<time datetime="' + esc(datetime) + '">Aggiornata ' + esc(updatedText) + '</time>'
              : esc(updatedText)) +
          '</p>' +
        '</div>' +
        '<div class="draft-card__actions">' +
          (copy.action
            ? '<button type="button" class="btn btn--primary btn--small" data-action="resume-draft"' +
                targetAttributes(item) + ' aria-label="' +
                esc(copy.action + ' ' + item.name) + '">' +
                esc(copy.action) + '</button>'
            : '') +
          '<button type="button" class="btn btn--ghost btn--small draft-card__delete" ' +
            'data-action="delete-draft"' + targetAttributes(item) +
            ' aria-label="Elimina la bozza ' + esc(item.name) + '">' +
            global.Icons.trash + ' Elimina' +
          '</button>' +
        '</div>' +
      '</article>' +
      '</li>'
    );
  }

  function render(container, items) {
    var list = Array.isArray(items) ? items : [];
    var html =
      '<div class="view draft-library-view animate-fade-in">' +
        '<div class="view-header view-header--back">' +
          '<button type="button" class="btn btn--icon view-back-button" data-action="go-home" ' +
            'aria-label="Torna alla home">' + global.Icons.arrowLeft + '</button>' +
          '<div>' +
            '<h1 class="view-header__title" tabindex="-1">Bozze locali</h1>' +
            '<p class="view-header__subtitle">' +
              'Sono salvate solo su questo dispositivo per 30 giorni.' +
            '</p>' +
          '</div>' +
        '</div>' +
        '<div class="draft-library-notice" role="note">' +
          '<strong>Il Backup JSON contiene le ricette salvate, non queste bozze.</strong>' +
          '<span>Completa le ricette importanti prima di cambiare dispositivo o cancellare i dati del browser.</span>' +
        '</div>';

    if (list.length === 0) {
      html +=
        '<div class="draft-library-empty">' +
          '<div class="draft-library-empty__icon">' + global.Icons.edit + '</div>' +
          '<h2>Nessuna bozza da recuperare</h2>' +
          '<p>Quando inizi una ricetta, le modifiche vengono salvate automaticamente qui.</p>' +
          '<button type="button" class="btn btn--primary" data-action="go-create">' +
            global.Icons.plus + ' Nuova ricetta' +
          '</button>' +
        '</div>';
    } else {
      html +=
        '<p class="draft-library-count" aria-live="polite">' +
          (list.length === 1 ? '1 bozza disponibile' : list.length + ' bozze disponibili') +
        '</p>' +
        '<ul class="draft-library-list">' +
          list.map(cardHTML).join('') +
        '</ul>';
    }
    html += '</div>';
    container.innerHTML = html;
  }

  function targetFromElement(element) {
    if (!element || !element.getAttribute) return null;
    var mode = element.getAttribute('data-draft-mode');
    var draftId = safeToken(element.getAttribute('data-draft-id'));
    var recipeId = mode === 'edit'
      ? safeToken(element.getAttribute('data-recipe-id'))
      : null;
    var revision = safeRevision(element.getAttribute('data-draft-revision'));
    if (
      (mode !== 'create' && mode !== 'edit') ||
      !draftId ||
      !revision ||
      (mode === 'edit' && !recipeId)
    ) {
      return null;
    }
    return {
      mode: mode,
      recipeId: recipeId,
      draftId: draftId,
      revision: revision,
      savedRecipeId: safeToken(element.getAttribute('data-saved-recipe-id'))
    };
  }

  global.DraftCatalog = {
    describe: describe,
    load: load,
    routeFor: routeFor,
    formatUpdatedAt: formatUpdatedAt,
    homeSummaryHTML: homeSummaryHTML,
    render: render,
    targetFromElement: targetFromElement
  };
})(typeof window !== 'undefined' ? window : globalThis);
