/**
 * Sapori — Recipe Business Logic Module
 * Categories, validation, filtering, sorting, and helpers.
 */
window.Recipes = {

  LIMITS: {
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
  },

  /**
   * Recipe categories with labels, icons, and colors.
   */
  CATEGORIES: [
    { id: 'antipasti', label: 'Antipasti',       icon: '🥗', color: '#FF6B6B' },
    { id: 'primi',    label: 'Primi Piatti',     icon: '🍝', color: '#FFA94D' },
    { id: 'secondi',  label: 'Secondi Piatti',  icon: '🥩', color: '#FF8787' },
    { id: 'contorni', label: 'Contorni',         icon: '🥬', color: '#69DB7C' },
    { id: 'dolci',    label: 'Dolci',            icon: '🍰', color: '#DA77F2' },
    { id: 'bevande',  label: 'Bevande',          icon: '🍹', color: '#74C0FC' },
    { id: 'altro',    label: 'Altro',            icon: '🍴', color: '#FFD43B' }
  ],

  /**
   * Difficulty levels with labels and emojis.
   */
  DIFFICULTIES: [
    { id: 'facile',    label: 'Facile',    emoji: '🟢' },
    { id: 'media',     label: 'Media',     emoji: '🟡' },
    { id: 'difficile', label: 'Difficile', emoji: '🔴' }
  ],

  /**
   * Common measurement units for Italian cooking.
   */
  UNITS: ['g', 'kg', 'ml', 'l', 'cucchiai', 'cucchiaini', 'tazze', 'pizzico', 'qb', 'pezzi', 'fette', 'spicchi', ''],

  /**
   * Validate a recipe object.
   * Returns { valid: boolean, errors: { fieldName: 'error message' } }
   * @param {Object} recipe
   * @returns {{valid: boolean, errors: Object}}
   */
  validate(recipe) {
    const errors = {};

    if (!recipe || typeof recipe !== 'object') {
      return { valid: false, errors: { _general: 'Dati ricetta non validi' } };
    }

    const limits = this.LIMITS;

    // Name: required, bounded string
    if (!recipe.name || typeof recipe.name !== 'string' || recipe.name.trim().length < 2) {
      errors.name = 'Il nome deve contenere almeno 2 caratteri';
    } else if (recipe.name.trim().length > limits.name) {
      errors.name = `Il nome non può superare ${limits.name} caratteri`;
    }

    if (recipe.description !== undefined && recipe.description !== null &&
        typeof recipe.description !== 'string') {
      errors.description = 'La descrizione deve essere testo';
    } else if (recipe.description && recipe.description.length > limits.description) {
      errors.description = `La descrizione non può superare ${limits.description} caratteri`;
    }

    if (recipe.notes !== undefined && recipe.notes !== null && typeof recipe.notes !== 'string') {
      errors.notes = 'Le note devono essere testo';
    } else if (recipe.notes && recipe.notes.length > limits.notes) {
      errors.notes = `Le note non possono superare ${limits.notes} caratteri`;
    }

    if (recipe.storage !== undefined && recipe.storage !== null && typeof recipe.storage !== 'string') {
      errors.storage = 'Le indicazioni di conservazione devono essere testo';
    } else if (recipe.storage && recipe.storage.length > limits.storage) {
      errors.storage = `Le indicazioni di conservazione non possono superare ${limits.storage} caratteri`;
    }

    // Category: must be one of CATEGORIES
    const validCategoryIds = this.CATEGORIES.map(c => c.id);
    if (!recipe.category || !validCategoryIds.includes(recipe.category)) {
      errors.category = 'Categoria non valida';
    }

    // Prep time: if provided, must be >= 0
    if (recipe.prepTime !== undefined && recipe.prepTime !== null && recipe.prepTime !== '') {
      const prep = Number(recipe.prepTime);
      if (!Number.isFinite(prep) || !Number.isInteger(prep) || prep < 0 || prep > limits.minutes) {
        errors.prepTime = `Inserisci minuti interi fra 0 e ${limits.minutes}`;
      }
    }

    // Cook time: if provided, must be >= 0
    if (recipe.cookTime !== undefined && recipe.cookTime !== null && recipe.cookTime !== '') {
      const cook = Number(recipe.cookTime);
      if (!Number.isFinite(cook) || !Number.isInteger(cook) || cook < 0 || cook > limits.minutes) {
        errors.cookTime = `Inserisci minuti interi fra 0 e ${limits.minutes}`;
      }
    }

    // Servings: if provided, must be > 0
    if (recipe.servings !== undefined && recipe.servings !== null && recipe.servings !== '') {
      const servings = Number(recipe.servings);
      if (!Number.isFinite(servings) || !Number.isInteger(servings) ||
          servings <= 0 || servings > limits.servings) {
        errors.servings = `Inserisci un numero intero di porzioni fra 1 e ${limits.servings}`;
      }
    }

    // Difficulty: if provided, must be valid
    if (recipe.difficulty !== undefined && recipe.difficulty !== null && recipe.difficulty !== '') {
      const validDifficulties = this.DIFFICULTIES.map(d => d.id);
      if (!validDifficulties.includes(recipe.difficulty)) {
        errors.difficulty = 'Difficoltà non valida';
      }
    }

    // Ingredients: at least one complete row, keeping original row indices.
    if (!Array.isArray(recipe.ingredients)) {
      errors.ingredients = 'Gli ingredienti devono essere una lista';
    } else if (recipe.ingredients.length === 0) {
      errors.ingredients = 'Inserisci almeno un ingrediente';
    } else if (recipe.ingredients.length > limits.ingredients) {
      errors.ingredients = `Puoi inserire al massimo ${limits.ingredients} ingredienti`;
    } else {
      for (let i = 0; i < recipe.ingredients.length; i++) {
        const ing = recipe.ingredients[i];
        if (!ing || typeof ing !== 'object' || Array.isArray(ing)) {
          errors[`ingredient_${i}`] = `Ingrediente ${i + 1}: formato non valido`;
          continue;
        }
        if (!ing.name || typeof ing.name !== 'string' || !ing.name.trim()) {
          errors[`ingredient_${i}`] = `Ingrediente ${i + 1}: il nome è obbligatorio`;
        } else if (ing.name.trim().length > limits.ingredientName) {
          errors[`ingredient_${i}`] = `Ingrediente ${i + 1}: massimo ${limits.ingredientName} caratteri`;
        }
        if (ing.quantity !== undefined && ing.quantity !== null &&
            String(ing.quantity).length > limits.ingredientQuantity) {
          errors[`ingredient_${i}`] = `Ingrediente ${i + 1}: quantità troppo lunga`;
        }
        if (ing.unit !== undefined && ing.unit !== null &&
            typeof ing.unit !== 'string') {
          errors[`ingredient_${i}`] = `Ingrediente ${i + 1}: unità non valida`;
        } else if (ing.unit && ing.unit.length > limits.ingredientUnit) {
          errors[`ingredient_${i}`] = `Ingrediente ${i + 1}: unità troppo lunga`;
        }
        if (ing.notes !== undefined && ing.notes !== null &&
            typeof ing.notes !== 'string') {
          errors[`ingredient_${i}`] = `Ingrediente ${i + 1}: note non valide`;
        } else if (ing.notes && ing.notes.length > limits.ingredientNotes) {
          errors[`ingredient_${i}`] = `Ingrediente ${i + 1}: note troppo lunghe`;
        }
      }
    }

    // Steps: at least one complete row, keeping original row indices.
    if (!Array.isArray(recipe.steps)) {
      errors.steps = 'I passaggi devono essere una lista';
    } else if (recipe.steps.length === 0) {
      errors.steps = 'Inserisci almeno un passaggio';
    } else if (recipe.steps.length > limits.steps) {
      errors.steps = `Puoi inserire al massimo ${limits.steps} passaggi`;
    } else {
      for (let i = 0; i < recipe.steps.length; i++) {
        const stepVal = recipe.steps[i];
        const text = typeof stepVal === 'object' && stepVal !== null ? stepVal.text : stepVal;
        const stepNotes = typeof stepVal === 'object' && stepVal !== null ? stepVal.notes : '';
        if (typeof text !== 'string' || !text.trim()) {
          errors[`step_${i}`] = `Passaggio ${i + 1}: il testo è obbligatorio`;
        } else if (text.trim().length > limits.stepText) {
          errors[`step_${i}`] = `Passaggio ${i + 1}: massimo ${limits.stepText} caratteri`;
        }
        if (stepNotes !== undefined && stepNotes !== null && typeof stepNotes !== 'string') {
          errors[`step_${i}`] = `Passaggio ${i + 1}: note non valide`;
        } else if (stepNotes && stepNotes.length > limits.stepNotes) {
          errors[`step_${i}`] = `Passaggio ${i + 1}: note troppo lunghe`;
        }
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors
    };
  },

  /**
   * Filter and sort an array of recipes.
   * Does NOT mutate the original array.
   *
   * @param {Array} recipes - Array of recipe objects
   * @param {Object} options
   * @param {string} options.search - Search text across all descriptive recipe fields
   * @param {string} options.category - Category ID filter (empty = all)
   * @param {string} options.sortBy - Sort key: 'recent', 'oldest', 'name_asc', 'name_desc', 'time_asc', 'time_desc'
   * @returns {Array} Filtered and sorted recipes (new array)
   */
  filterRecipes(recipes, { search = '', category = '', sortBy = 'recent' } = {}) {
    if (!Array.isArray(recipes)) return [];

    let result = [...recipes];

    // Filter by category
    if (category && typeof category === 'string') {
      result = result.filter(r => r.category === category);
    }

    // Filter by search text
    if (search && typeof search === 'string') {
      const normalizeSearchText = value => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('it-IT');
      const tokens = normalizeSearchText(search).trim().split(/\s+/).filter(Boolean);
      if (tokens.length) {
        result = result.filter(r => {
          const searchableParts = [
            r.name,
            r.description,
            r.notes,
            r.storage,
            r.category
          ];
          if (Array.isArray(r.ingredients)) {
            r.ingredients.forEach(ing => {
              if (!ing) return;
              searchableParts.push(ing.name, ing.notes, ing.quantity, ing.unit);
            });
          }
          if (Array.isArray(r.steps)) {
            r.steps.forEach(step => {
              const text = step && typeof step === 'object' ? step.text : step;
              const notes = step && typeof step === 'object' ? step.notes : '';
              searchableParts.push(text, notes);
            });
          }
          const haystack = normalizeSearchText(searchableParts.join(' '));
          return tokens.every(token => haystack.includes(token));
        });
      }
    }

    // Sort
    const getTotalTime = (r) => {
      const prep = Number(r.prepTime);
      const cook = Number(r.cookTime);
      const hasPrep = Number.isFinite(prep) && prep > 0;
      const hasCook = Number.isFinite(cook) && cook > 0;
      return hasPrep || hasCook ? (hasPrep ? prep : 0) + (hasCook ? cook : 0) : null;
    };
    const compareTime = (a, b, direction) => {
      const timeA = getTotalTime(a);
      const timeB = getTotalTime(b);
      if (timeA === null && timeB === null) return String(a.name || '').localeCompare(String(b.name || ''), 'it-IT');
      if (timeA === null) return 1;
      if (timeB === null) return -1;
      return direction * (timeA - timeB);
    };

    switch (sortBy) {
      case 'recent':
        result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        break;

      case 'oldest':
        result.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        break;

      case 'name_asc':
        result.sort((a, b) => {
          const nameA = (a.name || '').toLowerCase();
          const nameB = (b.name || '').toLowerCase();
          return nameA.localeCompare(nameB, 'it-IT');
        });
        break;

      case 'name_desc':
        result.sort((a, b) => {
          const nameA = (a.name || '').toLowerCase();
          const nameB = (b.name || '').toLowerCase();
          return nameB.localeCompare(nameA, 'it-IT');
        });
        break;

      case 'time_asc':
        result.sort((a, b) => compareTime(a, b, 1));
        break;

      case 'time_desc':
        result.sort((a, b) => compareTime(a, b, -1));
        break;

      default:
        // Default to recent
        result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        break;
    }

    return result;
  },

  /**
   * Create an empty recipe template with all fields set to defaults.
   * @returns {Object}
   */
  createEmptyRecipe() {
    return {
      id: null,
      name: '',
      category: 'altro',
      description: '',
      notes: '',
      storage: '',
      ingredients: [{ name: '', quantity: '', unit: '' }],
      steps: [''],
      prepTime: 0,
      cookTime: 0,
      difficulty: 'media',
      servings: 4,
      image: null,
      imageThumbnail: null,
      isFavorite: false,
      createdAt: null,
      updatedAt: null
    };
  },

  /**
   * Get a category object by its ID.
   * Falls back to the 'altro' category if not found.
   * @param {string} id
   * @returns {{id: string, label: string, icon: string, color: string}}
   */
  getCategoryById(id) {
    const defaultCategory = this.CATEGORIES.find(c => c.id === 'altro') ||
      { id: 'altro', label: 'Altro', icon: '🍴', color: '#FFD43B' };

    if (!id || typeof id !== 'string') return defaultCategory;

    return this.CATEGORIES.find(c => c.id === id) || defaultCategory;
  },

  /**
   * Clean up a recipe for JSON export.
   * Removes any internal/temporary fields and ensures structure.
   * @param {Object} recipe
   * @returns {Object}
   */
  formatRecipeForExport(recipe) {
    if (!recipe || typeof recipe !== 'object') return null;

    // Only include known fields, strip any internal ones
    const exported = {
      id: recipe.id || null,
      name: recipe.name || '',
      category: recipe.category || 'altro',
      description: recipe.description || '',
      notes: recipe.notes || '',
      storage: recipe.storage || '',
      ingredients: [],
      steps: [],
      prepTime: typeof recipe.prepTime === 'number' ? recipe.prepTime : 0,
      cookTime: typeof recipe.cookTime === 'number' ? recipe.cookTime : 0,
      difficulty: recipe.difficulty || 'media',
      servings: typeof recipe.servings === 'number' ? recipe.servings : 4,
      image: recipe.image || null,
      isFavorite: recipe.isFavorite === true,
      createdAt: recipe.createdAt || null,
      updatedAt: recipe.updatedAt || null
    };

    // Clean ingredients: only non-empty, with consistent shape
    if (Array.isArray(recipe.ingredients)) {
      exported.ingredients = recipe.ingredients
        .filter(ing => ing && ing.name && typeof ing.name === 'string' && ing.name.trim())
        .map(ing => ({
          name: ing.name.trim(),
          quantity: ing.quantity !== undefined && ing.quantity !== null ? String(ing.quantity).trim() : '',
          unit: ing.unit !== undefined && ing.unit !== null ? String(ing.unit).trim() : '',
          notes: ing.notes !== undefined && ing.notes !== null ? String(ing.notes).trim() : ''
        }));
    }

    // Clean steps: preserve strings or objects with text and notes
    if (Array.isArray(recipe.steps)) {
      exported.steps = recipe.steps
        .filter(s => {
          if (!s) return false;
          if (typeof s === 'string') return s.trim().length > 0;
          if (typeof s === 'object' && s.text) return String(s.text).trim().length > 0;
          return false;
        })
        .map(s => {
          if (typeof s === 'object') {
            return {
              text: String(s.text || '').trim(),
              notes: String(s.notes || '').trim()
            };
          }
          return { text: String(s).trim(), notes: '' };
        });
    }

    return exported;
  },

  /**
   * Match available ingredients against a list of recipes (Svuotafrigo mode).
   * @param {Array} recipes
   * @param {Array<string>} userIngredients
   * @returns {Array<{recipe: Object, matchedCount: number, totalCount: number, missingCount: number, matchRatio: number, matchedNames: Array, missingNames: Array, isComplete: boolean}>}
   */
  matchPantry(recipes, userIngredients) {
    if (!Array.isArray(recipes) || !Array.isArray(userIngredients) || userIngredients.length === 0) {
      return [];
    }

    const normUser = userIngredients
      .map(i => window.Utils ? window.Utils.slugify(i) : String(i).toLowerCase().trim())
      .filter(i => i.length > 0);

    if (normUser.length === 0) return [];

    const results = [];

    recipes.forEach(r => {
      if (!r || !r.ingredients || !Array.isArray(r.ingredients) || r.ingredients.length === 0) {
        return;
      }

      const totalIngs = r.ingredients.filter(ing => ing && ing.name && String(ing.name).trim().length > 0);
      if (totalIngs.length === 0) return;

      let matchedCount = 0;
      const matchedNames = [];
      const missingNames = [];

      totalIngs.forEach(ing => {
        const slugName = window.Utils ? window.Utils.slugify(ing.name) : String(ing.name).toLowerCase().trim();
        const ingredientTokens = slugName.split('-').filter(token => token.length > 1);
        const isMatched = normUser.some(u => {
          const userTokens = u.split('-').filter(token => token.length > 1);
          if (u === slugName) return true;
          if (userTokens.length === 0 || ingredientTokens.length === 0) return false;
          return ingredientTokens.every(token => userTokens.includes(token)) ||
                 userTokens.every(token => ingredientTokens.includes(token));
        });
        if (isMatched) {
          matchedCount++;
          matchedNames.push(ing.name);
        } else {
          missingNames.push(ing.name);
        }
      });

      if (matchedCount > 0) {
        const matchRatio = matchedCount / totalIngs.length;
        const missingCount = totalIngs.length - matchedCount;
        results.push({
          recipe: r,
          matchedCount,
          totalCount: totalIngs.length,
          missingCount,
          matchRatio,
          matchedNames,
          missingNames,
          isComplete: missingCount === 0
        });
      }
    });

    results.sort((a, b) => {
      if (b.matchRatio !== a.matchRatio) return b.matchRatio - a.matchRatio;
      if (a.missingCount !== b.missingCount) return a.missingCount - b.missingCount;
      return a.recipe.name.localeCompare(b.recipe.name, 'it-IT');
    });

    return results;
  }
};
