/**
 * Normalizza il contenuto delle bozze prima che venga mostrato nel form.
 *
 * Il modulo accetta anche ricette incomplete: una bozza non deve superare la
 * validazione richiesta al salvataggio definitivo. Vengono invece rimossi o
 * ricondotti a valori sicuri i dati corrotti, fuori limite o di tipo inatteso.
 */
(function (global) {
  'use strict';

  var CURRENT_VERSION = 1;
  var INVALID_PAYLOAD = 'INVALID_DRAFT_PAYLOAD';
  var FALLBACK_LIMITS = {
    name: 120,
    description: 2000,
    notes: 4000,
    storage: 1000,
    ingredients: 100,
    ingredientName: 160,
    ingredientQuantity: 50,
    ingredientUnit: 30,
    ingredientNotes: 500,
    steps: 100,
    stepText: 2000,
    stepNotes: 1000,
    minutes: 10080,
    servings: 1000
  };
  var RECIPE_FIELDS = [
    'id', 'name', 'category', 'description', 'notes', 'storage',
    'ingredients', 'steps', 'prepTime', 'cookTime', 'difficulty',
    'servings', 'image', 'imageThumbnail', 'isFavorite',
    'contentVersion', 'favoriteVersion', 'imageVersion',
    'createdAt', 'updatedAt'
  ];
  var TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
  var DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i;
  var DATA_THUMBNAIL_PATTERN = /^data:image\/jpeg;base64,/i;

  function schemaError(message, cause) {
    var error = new Error(message);
    error.name = 'DraftSchemaError';
    error.code = INVALID_PAYLOAD;
    error.recoverable = false;
    if (cause) error.cause = cause;
    return error;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      if (Object.prototype.toString.call(value) !== '[object Object]') return false;
      var prototype = Object.getPrototypeOf(value);
      if (prototype === null) return true;
      var constructor = Object.prototype.hasOwnProperty.call(prototype, 'constructor')
        ? prototype.constructor
        : null;
      return typeof constructor === 'function' && constructor.name === 'Object';
    } catch (error) {
      return false;
    }
  }

  function ownValue(source, key) {
    if (!isPlainObject(source)) return { found: false, value: undefined };
    try {
      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        return { found: false, value: undefined };
      }
      return { found: true, value: source[key] };
    } catch (error) {
      return { found: false, value: undefined };
    }
  }

  function sourceOrFallback(source, fallback, key) {
    var sourceEntry = ownValue(source, key);
    if (sourceEntry.found && sourceEntry.value !== undefined) return sourceEntry.value;
    var fallbackEntry = ownValue(fallback, key);
    return fallbackEntry.found ? fallbackEntry.value : undefined;
  }

  function resolveLimits() {
    var configured = global.Recipes && isPlainObject(global.Recipes.LIMITS)
      ? global.Recipes.LIMITS
      : null;
    var limits = {};
    Object.keys(FALLBACK_LIMITS).forEach(function (key) {
      var candidate = configured ? Number(configured[key]) : NaN;
      limits[key] = Number.isSafeInteger(candidate) && candidate > 0 &&
        candidate <= 1000000
        ? candidate
        : FALLBACK_LIMITS[key];
    });
    return limits;
  }

  function safeString(value, maximum, fallback) {
    var candidate = value;
    if (candidate === undefined) candidate = fallback;
    if (candidate === null || candidate === undefined) return '';
    if (
      typeof candidate !== 'string' &&
      typeof candidate !== 'number' &&
      typeof candidate !== 'boolean'
    ) {
      return '';
    }
    if (typeof candidate === 'number' && !Number.isFinite(candidate)) return '';
    try {
      return String(candidate).slice(0, maximum);
    } catch (error) {
      return '';
    }
  }

  function safeInteger(value, minimum, maximum, fallback) {
    var candidate = value === undefined ? fallback : value;
    var number;
    try {
      number = Number(candidate);
    } catch (error) {
      number = NaN;
    }
    if (
      !Number.isSafeInteger(number) ||
      number < minimum ||
      number > maximum
    ) {
      number = Number(fallback);
    }
    return Number.isSafeInteger(number) &&
      number >= minimum &&
      number <= maximum
      ? number
      : minimum;
  }

  function safeNullableInteger(value, fallback) {
    var candidate = value === undefined ? fallback : value;
    if (candidate === null || candidate === '') return null;
    var number;
    try {
      number = Number(candidate);
    } catch (error) {
      number = NaN;
    }
    if (!Number.isSafeInteger(number) || number < 0) {
      if (candidate !== fallback) return safeNullableInteger(fallback, null);
      return null;
    }
    return number;
  }

  function safeToken(value, fallback, defaultValue) {
    var token = safeString(value, 128, fallback).trim();
    if (TOKEN_PATTERN.test(token)) return token;
    var fallbackToken = safeString(fallback, 128, '').trim();
    return TOKEN_PATTERN.test(fallbackToken) ? fallbackToken : defaultValue;
  }

  function safeBoolean(value, fallback) {
    if (value === true || value === false) return value;
    return fallback === true;
  }

  function normalizeIngredient(value, limits) {
    var ingredient = isPlainObject(value) ? value : null;
    return {
      name: safeString(sourceOrFallback(ingredient, null, 'name'), limits.ingredientName, ''),
      quantity: safeString(
        sourceOrFallback(ingredient, null, 'quantity'),
        limits.ingredientQuantity,
        ''
      ),
      unit: safeString(sourceOrFallback(ingredient, null, 'unit'), limits.ingredientUnit, ''),
      notes: safeString(
        sourceOrFallback(ingredient, null, 'notes'),
        limits.ingredientNotes,
        ''
      )
    };
  }

  function normalizeStep(value, limits) {
    if (typeof value === 'string' || typeof value === 'number') {
      return {
        text: safeString(value, limits.stepText, ''),
        notes: ''
      };
    }
    var step = isPlainObject(value) ? value : null;
    return {
      text: safeString(sourceOrFallback(step, null, 'text'), limits.stepText, ''),
      notes: safeString(sourceOrFallback(step, null, 'notes'), limits.stepNotes, '')
    };
  }

  function normalizeList(source, fallback, limit, normalizeItem, blankItem) {
    var selected = Array.isArray(source)
      ? source
      : (source === undefined && Array.isArray(fallback) ? fallback : []);
    var normalized = selected.slice(0, limit).map(normalizeItem);
    if (normalized.length === 0) normalized.push(blankItem());
    return normalized;
  }

  function safeImage(value, fallback, maximum, pattern) {
    var candidate = value === undefined ? fallback : value;
    if (
      typeof candidate === 'string' &&
      candidate.length <= maximum &&
      pattern.test(candidate)
    ) {
      return candidate;
    }
    return null;
  }

  function hasRecipeField(value) {
    if (!isPlainObject(value)) return false;
    return RECIPE_FIELDS.some(function (field) {
      return ownValue(value, field).found;
    });
  }

  function normalizeRecipe(recipe, options) {
    options = isPlainObject(options) ? options : {};
    var baseRecipe = isPlainObject(options.baseRecipe) ? options.baseRecipe : null;
    var sourceRecipe = isPlainObject(recipe) ? recipe : null;
    var limits = resolveLimits();
    var mode = options.mode === 'edit' ? 'edit' : 'create';

    var sourceIngredients = ownValue(sourceRecipe, 'ingredients');
    var fallbackIngredients = ownValue(baseRecipe, 'ingredients');
    var sourceSteps = ownValue(sourceRecipe, 'steps');
    var fallbackSteps = ownValue(baseRecipe, 'steps');
    var rawId = sourceOrFallback(sourceRecipe, baseRecipe, 'id');
    var baseId = ownValue(baseRecipe, 'id').value;
    var id = safeToken(rawId, baseId, null);
    if (mode === 'edit') id = safeToken(baseId, rawId, null);

    var category = safeToken(
      sourceOrFallback(sourceRecipe, baseRecipe, 'category'),
      ownValue(baseRecipe, 'category').value,
      'altro'
    );
    var difficulty = safeString(
      sourceOrFallback(sourceRecipe, baseRecipe, 'difficulty'),
      16,
      'media'
    );
    if (['facile', 'media', 'difficile'].indexOf(difficulty) === -1) {
      difficulty = 'media';
    }

    var maximumImageLength = global.DB &&
      Number.isSafeInteger(Number(global.DB.MAX_IMAGE_DATA_URL_LENGTH))
      ? Number(global.DB.MAX_IMAGE_DATA_URL_LENGTH)
      : 7 * 1024 * 1024;

    var normalized = {
      id: id,
      name: safeString(
        sourceOrFallback(sourceRecipe, baseRecipe, 'name'),
        limits.name,
        ''
      ),
      category: category,
      description: safeString(
        sourceOrFallback(sourceRecipe, baseRecipe, 'description'),
        limits.description,
        ''
      ),
      notes: safeString(
        sourceOrFallback(sourceRecipe, baseRecipe, 'notes'),
        limits.notes,
        ''
      ),
      storage: safeString(
        sourceOrFallback(sourceRecipe, baseRecipe, 'storage'),
        limits.storage,
        ''
      ),
      ingredients: normalizeList(
        sourceIngredients.found ? sourceIngredients.value : undefined,
        fallbackIngredients.value,
        limits.ingredients,
        function (ingredient) { return normalizeIngredient(ingredient, limits); },
        function () { return normalizeIngredient(null, limits); }
      ),
      steps: normalizeList(
        sourceSteps.found ? sourceSteps.value : undefined,
        fallbackSteps.value,
        limits.steps,
        function (step) { return normalizeStep(step, limits); },
        function () { return normalizeStep(null, limits); }
      ),
      prepTime: safeInteger(
        sourceOrFallback(sourceRecipe, baseRecipe, 'prepTime'),
        0,
        limits.minutes,
        0
      ),
      cookTime: safeInteger(
        sourceOrFallback(sourceRecipe, baseRecipe, 'cookTime'),
        0,
        limits.minutes,
        0
      ),
      difficulty: difficulty,
      servings: safeInteger(
        sourceOrFallback(sourceRecipe, baseRecipe, 'servings'),
        1,
        limits.servings,
        4
      ),
      image: safeImage(
        ownValue(sourceRecipe, 'image').found
          ? ownValue(sourceRecipe, 'image').value
          : undefined,
        ownValue(baseRecipe, 'image').value,
        maximumImageLength,
        DATA_IMAGE_PATTERN
      ),
      imageThumbnail: safeImage(
        ownValue(sourceRecipe, 'imageThumbnail').found
          ? ownValue(sourceRecipe, 'imageThumbnail').value
          : undefined,
        ownValue(baseRecipe, 'imageThumbnail').value,
        750000,
        DATA_THUMBNAIL_PATTERN
      ),
      isFavorite: safeBoolean(
        sourceOrFallback(sourceRecipe, baseRecipe, 'isFavorite'),
        ownValue(baseRecipe, 'isFavorite').value
      ),
      contentVersion: safeInteger(
        sourceOrFallback(sourceRecipe, baseRecipe, 'contentVersion'),
        0,
        Number.MAX_SAFE_INTEGER,
        0
      ),
      favoriteVersion: safeInteger(
        sourceOrFallback(sourceRecipe, baseRecipe, 'favoriteVersion'),
        0,
        Number.MAX_SAFE_INTEGER,
        0
      ),
      imageVersion: safeInteger(
        sourceOrFallback(sourceRecipe, baseRecipe, 'imageVersion'),
        0,
        Number.MAX_SAFE_INTEGER,
        0
      ),
      createdAt: safeNullableInteger(
        sourceOrFallback(sourceRecipe, baseRecipe, 'createdAt'),
        null
      ),
      updatedAt: safeNullableInteger(
        sourceOrFallback(sourceRecipe, baseRecipe, 'updatedAt'),
        null
      )
    };

    if (mode === 'edit' && baseRecipe) {
      normalized.id = safeToken(baseId, normalized.id, null);
      normalized.createdAt = safeNullableInteger(
        ownValue(baseRecipe, 'createdAt').value,
        normalized.createdAt
      );
      normalized.isFavorite = safeBoolean(
        ownValue(baseRecipe, 'isFavorite').value,
        normalized.isFavorite
      );
      normalized.favoriteVersion = safeInteger(
        ownValue(baseRecipe, 'favoriteVersion').value,
        0,
        Number.MAX_SAFE_INTEGER,
        normalized.favoriteVersion
      );
    }

    return normalized;
  }

  function normalize(payload, options) {
    if (!isPlainObject(payload)) {
      throw schemaError('Il contenuto della bozza non è un oggetto valido.');
    }

    options = isPlainObject(options) ? options : {};
    var recipeEntry = ownValue(payload, 'recipe');
    var recipe = isPlainObject(recipeEntry.value)
      ? recipeEntry.value
      : (!recipeEntry.found && hasRecipeField(payload) ? payload : null);
    var normalizedRecipe = normalizeRecipe(recipe, options);
    var activeTab = safeString(ownValue(payload, 'activeTab').value, 32, 'tab-info');
    if (['tab-info', 'tab-prep', 'tab-cook'].indexOf(activeTab) === -1) {
      activeTab = 'tab-info';
    }

    return {
      version: CURRENT_VERSION,
      recipe: normalizedRecipe,
      activeTab: activeTab,
      baseContentVersion: safeInteger(
        ownValue(payload, 'baseContentVersion').value,
        0,
        Number.MAX_SAFE_INTEGER,
        normalizedRecipe.contentVersion
      ),
      baseUpdatedAt: safeNullableInteger(
        ownValue(payload, 'baseUpdatedAt').value,
        ownValue(options.baseRecipe, 'updatedAt').value
      )
    };
  }

  function tryNormalize(payload, options) {
    try {
      return { valid: true, data: normalize(payload, options), error: null };
    } catch (error) {
      var normalizedError = error && error.name === 'DraftSchemaError'
        ? error
        : schemaError('Impossibile interpretare il contenuto della bozza.', error);
      return { valid: false, data: null, error: normalizedError };
    }
  }

  global.DraftSchema = {
    CURRENT_VERSION: CURRENT_VERSION,
    INVALID_PAYLOAD: INVALID_PAYLOAD,
    isPlainObject: isPlainObject,
    normalizeRecipe: normalizeRecipe,
    normalize: normalize,
    tryNormalize: tryNormalize
  };
})(typeof window !== 'undefined' ? window : globalThis);
