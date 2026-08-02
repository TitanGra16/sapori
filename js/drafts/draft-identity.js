/**
 * Identità stabile e confronto rigoroso delle ricette nate da una bozza.
 *
 * Il confronto usato qui è volutamente più severo della deduplicazione dei
 * backup: una bozza può essere eliminata come residuo soltanto se ogni campo
 * salvabile, comprese maiuscole e foto completa, coincide davvero.
 */
(function (global) {
  'use strict';

  var SAFE_TOKEN = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

  function safeToken(value) {
    var token = typeof value === 'string' ? value.trim() : '';
    return SAFE_TOKEN.test(token) ? token : null;
  }

  function hashToken(value) {
    var seeds = [2166136261, 2246822507, 3266489909, 668265263];
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      seeds = seeds.map(function (seed, seedIndex) {
        var mixed = seed ^ (code + seedIndex * 131);
        return Math.imul(mixed, 16777619 + seedIndex * 2) >>> 0;
      });
    }
    return seeds.map(function (seed) {
      return seed.toString(16).padStart(8, '0');
    }).join('');
  }

  function derivedId(prefix, draftId) {
    var token = safeToken(draftId);
    if (!token) {
      throw new Error('ID bozza non valido per creare l’identità della ricetta.');
    }
    if (prefix.length + token.length <= 128) {
      return prefix + token;
    }
    return prefix + hashToken(token);
  }

  function recipeIdForDraft(draftId) {
    return derivedId('ricetta-', draftId);
  }

  function copyRecipeIdForDraft(draftId) {
    return derivedId('copia-', draftId);
  }

  function plainObject(value) {
    return value && Object.prototype.toString.call(value) === '[object Object]'
      ? value
      : {};
  }

  function text(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function number(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function canonicalIngredients(value) {
    return (Array.isArray(value) ? value : []).map(function (ingredient) {
      ingredient = plainObject(ingredient);
      return {
        name: text(ingredient.name),
        quantity: text(ingredient.quantity),
        unit: text(ingredient.unit),
        notes: text(ingredient.notes)
      };
    });
  }

  function canonicalSteps(value) {
    return (Array.isArray(value) ? value : []).map(function (step) {
      step = plainObject(step);
      return {
        text: text(step.text),
        notes: text(step.notes)
      };
    });
  }

  function contentFingerprint(recipe) {
    recipe = plainObject(recipe);
    return JSON.stringify({
      name: text(recipe.name),
      category: text(recipe.category) || 'altro',
      description: text(recipe.description),
      notes: text(recipe.notes),
      storage: text(recipe.storage),
      ingredients: canonicalIngredients(recipe.ingredients),
      steps: canonicalSteps(recipe.steps),
      prepTime: number(recipe.prepTime, 0),
      cookTime: number(recipe.cookTime, 0),
      difficulty: text(recipe.difficulty) || 'media',
      servings: number(recipe.servings, 4)
    });
  }

  function sameContent(first, second) {
    return contentFingerprint(first) === contentFingerprint(second);
  }

  function fullImage(recipe) {
    recipe = plainObject(recipe);
    return typeof recipe.image === 'string' && recipe.image
      ? recipe.image
      : null;
  }

  function sameRecipeVersion(first, second) {
    return sameContent(first, second) && fullImage(first) === fullImage(second);
  }

  global.DraftIdentity = {
    recipeIdForDraft: recipeIdForDraft,
    copyRecipeIdForDraft: copyRecipeIdForDraft,
    contentFingerprint: contentFingerprint,
    sameContent: sameContent,
    sameRecipeVersion: sameRecipeVersion
  };
})(typeof window !== 'undefined' ? window : globalThis);
