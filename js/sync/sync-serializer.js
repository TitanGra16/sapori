/**
 * Serializzazione dei payload cloud di Sapori.
 *
 * Mantiene ricette, preferiti e fotografie in canali separati. Nessun campo
 * interno di IndexedDB, thumbnail o data URL viene inserito nel database
 * remoto.
 */
(function () {
  'use strict';

  var IMAGE_TYPES = Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  });

  function text(value, maximum) {
    if (value === undefined || value === null) return '';
    return String(value).trim().slice(0, maximum);
  }

  function integer(value, fallback, minimum, maximum) {
    var number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      return fallback;
    }
    return number;
  }

  function timestamp(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
  }

  function serializeIngredients(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 100).map(function (ingredient) {
      ingredient = ingredient && typeof ingredient === 'object' ? ingredient : {};
      return {
        name: text(ingredient.name, 200),
        quantity: text(ingredient.quantity, 80),
        unit: text(ingredient.unit, 80),
        notes: text(ingredient.notes, 500)
      };
    }).filter(function (ingredient) { return Boolean(ingredient.name); });
  }

  function serializeSteps(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 100).map(function (step) {
      if (typeof step === 'string') {
        return { text: text(step, 4000), notes: '' };
      }
      step = step && typeof step === 'object' ? step : {};
      return {
        text: text(step.text, 4000),
        notes: text(step.notes, 2000)
      };
    }).filter(function (step) { return Boolean(step.text); });
  }

  function serializeContent(recipe) {
    if (!recipe || typeof recipe !== 'object') {
      throw new Error('Ricetta non disponibile per la sincronizzazione');
    }

    return {
      recipe: {
        schemaVersion: 1,
        name: text(recipe.name, 200),
        category: text(recipe.category || 'altro', 128),
        description: text(recipe.description, 2000),
        notes: text(recipe.notes, 4000),
        storage: text(recipe.storage, 1000),
        ingredients: serializeIngredients(recipe.ingredients),
        steps: serializeSteps(recipe.steps),
        prepTime: integer(recipe.prepTime, 0, 0, 100000),
        cookTime: integer(recipe.cookTime, 0, 0, 100000),
        difficulty: ['facile', 'media', 'difficile'].indexOf(recipe.difficulty) !== -1
          ? recipe.difficulty
          : 'media',
        servings: integer(recipe.servings, 4, 1, 1000),
        createdAt: timestamp(recipe.createdAt),
        updatedAt: timestamp(recipe.updatedAt)
      }
    };
  }

  function serializeFavorite(recipe) {
    if (!recipe || typeof recipe !== 'object') {
      throw new Error('Ricetta non disponibile per sincronizzare il preferito');
    }
    return { value: recipe.isFavorite === true };
  }

  function normalizeCategory(category) {
    if (!category || typeof category !== 'object') return null;
    var label = text(category.label || category.name, 60);
    var id = text(category.id, 80).toLowerCase();
    var icon = text(category.icon || '🍴', 16) || '🍴';
    var colorValue = text(category.color, 7);
    var color = /^#[0-9a-f]{6}$/i.test(colorValue) ? colorValue : '#E85D3A';
    var reserved = new Set(
      window.DB && Array.isArray(window.DB.BUILTIN_CATEGORY_IDS)
        ? window.DB.BUILTIN_CATEGORY_IDS
        : ['antipasti', 'primi', 'secondi', 'contorni', 'dolci', 'bevande', 'altro']
    );
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id) || !label || reserved.has(id)) {
      return null;
    }
    return {
      id: id,
      label: label,
      icon: icon,
      color: color,
      isCustom: true
    };
  }

  function serializeCategories(value) {
    var parsed = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch (error) {
        parsed = [];
      }
    }
    if (!Array.isArray(parsed)) parsed = [];

    var seen = new Set();
    var items = [];
    parsed.slice(0, 100).forEach(function (category) {
      var normalized = normalizeCategory(category);
      if (!normalized || seen.has(normalized.id)) return;
      seen.add(normalized.id);
      items.push(normalized);
    });
    return { items: items };
  }

  function dataUrlToBlob(dataUrl) {
    if (typeof dataUrl !== 'string') {
      throw new Error('Fotografia locale non disponibile');
    }
    var match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
    if (!match) throw new Error('Formato fotografia locale non valido');

    var binary = window.atob(match[2].replace(/\s/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: match[1].toLowerCase() });
  }

  function blobToDataUrl(blob) {
    if (!(blob instanceof Blob) || !IMAGE_TYPES[blob.type]) {
      return Promise.reject(new Error('Fotografia cloud non valida'));
    }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('Lettura fotografia non riuscita')); };
      reader.readAsDataURL(blob);
    });
  }

  function buildStoragePath(userId, recipeId, operationId, mimeType) {
    var safeUser = text(userId, 100);
    var safeRecipe = text(recipeId, 128);
    var safeOperation = text(operationId, 100);
    var extension = IMAGE_TYPES[mimeType];
    if (!/^[0-9a-f-]{36}$/i.test(safeUser) ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(safeRecipe) ||
        !/^[0-9a-f-]{36}$/i.test(safeOperation) ||
        !extension) {
      throw new Error('Percorso fotografia cloud non valido');
    }
    return safeUser + '/' + safeRecipe + '/' + safeOperation + '.' + extension;
  }

  function serializeImage(path, blob) {
    if (typeof path !== 'string' || !(blob instanceof Blob) || !IMAGE_TYPES[blob.type]) {
      throw new Error('Fotografia non valida per il caricamento');
    }
    if (blob.size < 1 || blob.size > 8 * 1024 * 1024) {
      throw new Error('La fotografia supera il limite cloud di 8 MB');
    }
    return {
      path: path,
      mimeType: blob.type,
      bytes: blob.size
    };
  }

  window.SyncSerializer = Object.freeze({
    IMAGE_TYPES: IMAGE_TYPES,
    serializeContent: serializeContent,
    serializeFavorite: serializeFavorite,
    serializeCategories: serializeCategories,
    dataUrlToBlob: dataUrlToBlob,
    blobToDataUrl: blobToDataUrl,
    buildStoragePath: buildStoragePath,
    serializeImage: serializeImage
  });
})();
