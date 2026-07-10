/**
 * Sapori — Recipe Business Logic Module
 * Categories, validation, filtering, sorting, and helpers.
 */
window.Recipes = {

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

    // Name: required, min 2 characters
    if (!recipe.name || typeof recipe.name !== 'string' || recipe.name.trim().length < 2) {
      errors.name = 'Il nome deve contenere almeno 2 caratteri';
    }

    // Category: must be one of CATEGORIES
    const validCategoryIds = this.CATEGORIES.map(c => c.id);
    if (!recipe.category || !validCategoryIds.includes(recipe.category)) {
      errors.category = 'Categoria non valida';
    }

    // Prep time: if provided, must be >= 0
    if (recipe.prepTime !== undefined && recipe.prepTime !== null && recipe.prepTime !== '') {
      const prep = Number(recipe.prepTime);
      if (isNaN(prep) || prep < 0) {
        errors.prepTime = 'Il tempo di preparazione deve essere un numero positivo';
      }
    }

    // Cook time: if provided, must be >= 0
    if (recipe.cookTime !== undefined && recipe.cookTime !== null && recipe.cookTime !== '') {
      const cook = Number(recipe.cookTime);
      if (isNaN(cook) || cook < 0) {
        errors.cookTime = 'Il tempo di cottura deve essere un numero positivo';
      }
    }

    // Servings: if provided, must be > 0
    if (recipe.servings !== undefined && recipe.servings !== null && recipe.servings !== '') {
      const servings = Number(recipe.servings);
      if (isNaN(servings) || servings <= 0) {
        errors.servings = 'Il numero di porzioni deve essere maggiore di zero';
      }
    }

    // Difficulty: if provided, must be valid
    if (recipe.difficulty !== undefined && recipe.difficulty !== null && recipe.difficulty !== '') {
      const validDifficulties = this.DIFFICULTIES.map(d => d.id);
      if (!validDifficulties.includes(recipe.difficulty)) {
        errors.difficulty = 'Difficoltà non valida';
      }
    }

    // Ingredients: if present, each must have a name
    if (recipe.ingredients !== undefined && recipe.ingredients !== null) {
      if (!Array.isArray(recipe.ingredients)) {
        errors.ingredients = 'Gli ingredienti devono essere una lista';
      } else {
        // Filter out completely empty ingredient rows before validation
        const nonEmptyIngredients = recipe.ingredients.filter(ing =>
          ing && (
            (ing.name && ing.name.trim()) ||
            (ing.quantity && String(ing.quantity).trim()) ||
            (ing.unit && ing.unit.trim())
          )
        );

        for (let i = 0; i < nonEmptyIngredients.length; i++) {
          const ing = nonEmptyIngredients[i];
          if (!ing || typeof ing !== 'object') {
            errors[`ingredient_${i}`] = `Ingrediente ${i + 1}: formato non valido`;
          } else if (!ing.name || typeof ing.name !== 'string' || !ing.name.trim()) {
            errors[`ingredient_${i}`] = `Ingrediente ${i + 1}: il nome è obbligatorio`;
          }
        }
      }
    }

    // Steps: if present, each must be a non-empty string
    if (recipe.steps !== undefined && recipe.steps !== null) {
      if (!Array.isArray(recipe.steps)) {
        errors.steps = 'I passaggi devono essere una lista';
      } else {
        // Filter out empty steps before validation
        const nonEmptySteps = recipe.steps.filter(s => s && typeof s === 'string' && s.trim());

        for (let i = 0; i < nonEmptySteps.length; i++) {
          if (typeof nonEmptySteps[i] !== 'string' || !nonEmptySteps[i].trim()) {
            errors[`step_${i}`] = `Passaggio ${i + 1}: il testo è obbligatorio`;
          }
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
   * @param {string} options.search - Search text (matches name, description, ingredient names)
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
      const query = search.toLowerCase().trim();
      if (query) {
        result = result.filter(r => {
          // Match name
          if (r.name && r.name.toLowerCase().includes(query)) return true;

          // Match description
          if (r.description && r.description.toLowerCase().includes(query)) return true;

          // Match ingredient names
          if (Array.isArray(r.ingredients)) {
            for (const ing of r.ingredients) {
              if (ing && ing.name && ing.name.toLowerCase().includes(query)) {
                return true;
              }
            }
          }

          return false;
        });
      }
    }

    // Sort
    const getTotalTime = (r) => {
      const prep = (typeof r.prepTime === 'number' && !isNaN(r.prepTime)) ? r.prepTime : 0;
      const cook = (typeof r.cookTime === 'number' && !isNaN(r.cookTime)) ? r.cookTime : 0;
      return prep + cook;
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
        result.sort((a, b) => getTotalTime(a) - getTotalTime(b));
        break;

      case 'time_desc':
        result.sort((a, b) => getTotalTime(b) - getTotalTime(a));
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
      ingredients: [{ name: '', quantity: '', unit: '' }],
      steps: [''],
      prepTime: 0,
      cookTime: 0,
      difficulty: 'media',
      servings: 4,
      image: null,
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
          unit: ing.unit !== undefined && ing.unit !== null ? String(ing.unit).trim() : ''
        }));
    }

    // Clean steps: only non-empty strings
    if (Array.isArray(recipe.steps)) {
      exported.steps = recipe.steps
        .filter(s => s && typeof s === 'string' && s.trim())
        .map(s => s.trim());
    }

    return exported;
  }
};
