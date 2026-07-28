/**
 * Sapori — IndexedDB Storage Module
 * Database: SaporiDB v2
 * Stores: recipes metadata, full-size images, settings.
 */
window.DB = {
  db: null,
  initPromise: null,
  MAX_IMPORT_BYTES: 50 * 1024 * 1024,
  MAX_IMPORT_RECIPES: 5000,
  BUILTIN_CATEGORY_IDS: ['antipasti', 'primi', 'secondi', 'contorni', 'dolci', 'bevande', 'altro'],

  /**
   * Initialize the IndexedDB database.
   * Creates object stores and indexes on first run.
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('SaporiDB', 2);

      request.onerror = () => {
        reject(new Error('Impossibile aprire il database: ' + request.error));
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create "recipes" store
        if (!db.objectStoreNames.contains('recipes')) {
          const recipesStore = db.createObjectStore('recipes', { keyPath: 'id' });
          recipesStore.createIndex('name', 'name', { unique: false });
          recipesStore.createIndex('category', 'category', { unique: false });
          recipesStore.createIndex('createdAt', 'createdAt', { unique: false });
          recipesStore.createIndex('isFavorite', 'isFavorite', { unique: false });
        }

        // Create "settings" store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'recipeId' });
        }
      };

      request.onblocked = () => {
        reject(new Error('Il database è aperto in un’altra scheda non aggiornata. Chiudila e riprova.'));
      };

      request.onsuccess = () => {
        this.db = request.result;

        // Handle unexpected close (e.g. version change from another tab)
        this.db.onclose = () => {
          this.db = null;
        };
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
        };

        this._migrateLegacyImages().then(() => resolve(this.db)).catch(error => {
          this.db.close();
          this.db = null;
          reject(error);
        });
      };
    });

    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  },

  /**
   * Ensure the database is initialized before any operation.
   * @returns {Promise<IDBDatabase>}
   */
  async _ensureDB() {
    if (!this.db) {
      await this.init();
    }
    return this.db;
  },

  _isDataImage(value) {
    return typeof value === 'string' &&
      value.length <= 7 * 1024 * 1024 &&
      /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value);
  },

  _toStoredRecipe(recipe, thumbnail) {
    const fullImage = this._isDataImage(recipe && recipe.image) ? recipe.image : null;
    const candidateThumbnail = thumbnail !== undefined ? thumbnail : recipe && recipe.imageThumbnail;
    const imageThumbnail = typeof candidateThumbnail === 'string' &&
      candidateThumbnail.length <= 750000 &&
      /^data:image\/jpeg;base64,/i.test(candidateThumbnail)
      ? candidateThumbnail
      : null;

    return {
      stored: {
        ...recipe,
        image: null,
        imageThumbnail,
        hasImage: Boolean(fullImage)
      },
      fullImage
    };
  },

  async _createThumbnail(image) {
    if (!image || !window.Utils || typeof window.Utils.createImageThumbnail !== 'function') return null;
    try {
      return await window.Utils.createImageThumbnail(image, 360);
    } catch (error) {
      return null;
    }
  },

  async _migrateLegacyImages() {
    if (!this.db || !this.db.objectStoreNames.contains('images')) return;
    const readTx = this.db.transaction('recipes', 'readonly');
    const recipes = await this._promisify(readTx.objectStore('recipes').getAll());
    const legacy = recipes.filter(recipe => this._isDataImage(recipe.image));
    if (legacy.length === 0) return;

    const migrated = [];
    for (const recipe of legacy) {
      migrated.push({
        recipe,
        thumbnail: await this._createThumbnail(recipe.image)
      });
    }
    const writeTx = this.db.transaction(['recipes', 'images'], 'readwrite');
    const recipeStore = writeTx.objectStore('recipes');
    const imageStore = writeTx.objectStore('images');
    migrated.forEach(item => {
      const prepared = this._toStoredRecipe(item.recipe, item.thumbnail);
      recipeStore.put(prepared.stored);
      imageStore.put({ recipeId: item.recipe.id, data: prepared.fullImage });
    });
    await this._txComplete(writeTx);
  },

  async _getRawRecipes() {
    const db = await this._ensureDB();
    const tx = db.transaction('recipes', 'readonly');
    return this._promisify(tx.objectStore('recipes').getAll());
  },

  async getRecipeSummaries() {
    const recipes = await this._getRawRecipes();
    return recipes
      .map(recipe => ({
        ...recipe,
        image: recipe.imageThumbnail || (this._isDataImage(recipe.image) ? recipe.image : null)
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  async countRecipes(category) {
    const db = await this._ensureDB();
    const tx = db.transaction('recipes', 'readonly');
    const store = tx.objectStore('recipes');
    const request = category
      ? store.index('category').count(category)
      : store.count();
    return this._promisify(request);
  },

  /**
   * Helper: wrap an IDBRequest in a Promise.
   * @param {IDBRequest} request
   * @returns {Promise<any>}
   */
  _promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Helper: wrap an IDBTransaction completion in a Promise.
   * @param {IDBTransaction} tx
   * @returns {Promise<void>}
   */
  _txComplete(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transazione annullata'));
    });
  },

  /**
   * Get all recipes, sorted by createdAt descending (most recent first).
   * @returns {Promise<Array>}
   */
  async getAllRecipes() {
    const db = await this._ensureDB();
    const tx = db.transaction(['recipes', 'images'], 'readonly');
    const recipesPromise = this._promisify(tx.objectStore('recipes').getAll());
    const imagesPromise = this._promisify(tx.objectStore('images').getAll());
    const [recipes, images] = await Promise.all([recipesPromise, imagesPromise]);
    const imagesByRecipe = new Map(images.map(image => [image.recipeId, image.data]));
    const hydrated = recipes.map(recipe => ({
      ...recipe,
      image: imagesByRecipe.get(recipe.id) ||
        (this._isDataImage(recipe.image) ? recipe.image : null)
    }));

    // Sort by createdAt descending
    hydrated.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return hydrated;
  },

  /**
   * Get a single recipe by its ID.
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  async getRecipe(id) {
    if (!id) return undefined;

    const db = await this._ensureDB();
    const tx = db.transaction(['recipes', 'images'], 'readonly');
    const recipePromise = this._promisify(tx.objectStore('recipes').get(id));
    const imagePromise = this._promisify(tx.objectStore('images').get(id));
    const [recipe, imageRecord] = await Promise.all([recipePromise, imagePromise]);
    if (!recipe) return undefined;
    return {
      ...recipe,
      image: imageRecord && imageRecord.data
        ? imageRecord.data
        : (this._isDataImage(recipe.image) ? recipe.image : null)
    };
  },

  /**
   * Add a new recipe to the store.
   * Automatically assigns id, createdAt, and updatedAt.
   * @param {Object} recipe
   * @returns {Promise<string>} The new recipe ID
   */
  async addRecipe(recipe) {
    const db = await this._ensureDB();

    const now = Date.now();
    const newRecipe = {
      ...recipe,
      id: window.Utils ? window.Utils.generateId() : (crypto.randomUUID ? crypto.randomUUID() : this._fallbackId()),
      createdAt: now,
      updatedAt: now
    };
    const prepared = this._toStoredRecipe(newRecipe);

    const tx = db.transaction(['recipes', 'images'], 'readwrite');
    tx.objectStore('recipes').add(prepared.stored);
    if (prepared.fullImage) {
      tx.objectStore('images').put({ recipeId: newRecipe.id, data: prepared.fullImage });
    }
    await this._txComplete(tx);

    return newRecipe.id;
  },

  /**
   * Update an existing recipe. Requires recipe.id to be set.
   * Automatically updates updatedAt.
   * @param {Object} recipe
   * @returns {Promise<void>}
   */
  async updateRecipe(recipe) {
    if (!recipe || !recipe.id) {
      throw new Error('ID ricetta mancante per l\'aggiornamento');
    }

    const db = await this._ensureDB();

    const updatedRecipe = {
      ...recipe,
      updatedAt: Date.now()
    };
    const prepared = this._toStoredRecipe(updatedRecipe);

    const tx = db.transaction(['recipes', 'images'], 'readwrite');
    tx.objectStore('recipes').put(prepared.stored);
    const imageStore = tx.objectStore('images');
    if (prepared.fullImage) {
      imageStore.put({ recipeId: recipe.id, data: prepared.fullImage });
    } else {
      imageStore.delete(recipe.id);
    }
    await this._txComplete(tx);
  },

  /**
   * Delete a recipe by its ID.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteRecipe(id) {
    if (!id) {
      throw new Error('ID ricetta mancante per l\'eliminazione');
    }

    const db = await this._ensureDB();
    const tx = db.transaction(['recipes', 'images'], 'readwrite');
    tx.objectStore('recipes').delete(id);
    tx.objectStore('images').delete(id);
    await this._txComplete(tx);
  },

  async deleteCustomCategory(categoryId, toCategory = 'altro') {
    if (!categoryId || this.BUILTIN_CATEGORY_IDS.includes(categoryId)) {
      throw new Error('Categoria personalizzata non valida');
    }
    if (!this.BUILTIN_CATEGORY_IDS.includes(toCategory)) {
      throw new Error('Categoria di destinazione non valida');
    }

    const db = await this._ensureDB();
    const tx = db.transaction(['recipes', 'settings'], 'readwrite');
    const recipeStore = tx.objectStore('recipes');
    const settingsStore = tx.objectStore('settings');
    const [recipes, settingsRecord] = await Promise.all([
      this._promisify(recipeStore.getAll()),
      this._promisify(settingsStore.get('customCategories'))
    ]);
    const customCategories = this._parseCustomCategories(settingsRecord ? settingsRecord.value : [])
      .filter(category => category.id !== categoryId);
    let movedRecipes = 0;

    recipes.forEach(recipe => {
      if (recipe.category === categoryId) {
        recipeStore.put({ ...recipe, category: toCategory, updatedAt: Date.now() });
        movedRecipes++;
      }
    });
    settingsStore.put({ key: 'customCategories', value: JSON.stringify(customCategories) });
    await this._txComplete(tx);

    return { movedRecipes, customCategories };
  },

  /**
   * Get a setting value by key.
   * @param {string} key
   * @returns {Promise<any>} The value, or undefined if not found
   */
  async getSetting(key) {
    if (!key) return undefined;

    const db = await this._ensureDB();
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const result = await this._promisify(store.get(key));

    return result ? result.value : undefined;
  },

  /**
   * Set a setting key-value pair.
   * @param {string} key
   * @param {any} value
   * @returns {Promise<void>}
   */
  async setSetting(key, value) {
    if (!key) {
      throw new Error('Chiave impostazione mancante');
    }

    const db = await this._ensureDB();
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    store.put({ key, value });
    await this._txComplete(tx);
  },

  async getAllSettings() {
    const db = await this._ensureDB();
    const tx = db.transaction('settings', 'readonly');
    const entries = await this._promisify(tx.objectStore('settings').getAll());
    return entries.reduce((result, entry) => {
      result[entry.key] = entry.value;
      return result;
    }, {});
  },

  /**
   * Export all recipes as a JSON string with metadata.
   * @returns {Promise<string>}
   */
  async exportData() {
    const recipes = await this.getAllRecipes();
    const settings = await this.getAllSettings();

    const exportPayload = {
      appName: 'Sapori',
      version: 2,
      exportDate: new Date().toISOString(),
      recipeCount: recipes.length,
      recipes: recipes.map(recipe => window.Recipes ? window.Recipes.formatRecipeForExport(recipe) : recipe),
      settings: {
        customCategories: settings.customCategories || '[]',
        themeMode: settings.themeMode || null,
        themePalette: settings.themePalette || null
      }
    };

    return JSON.stringify(exportPayload, null, 2);
  },

  _parseCustomCategories(value) {
    let categories = value;
    if (typeof categories === 'string') {
      try {
        categories = JSON.parse(categories);
      } catch (e) {
        categories = [];
      }
    }
    if (!Array.isArray(categories)) return [];

    const seen = new Set();
    const reserved = new Set(this.BUILTIN_CATEGORY_IDS);
    return categories.slice(0, 100).map(category => {
      if (!category || typeof category !== 'object') return null;
      const label = String(category.label || '').trim().slice(0, 60);
      const baseId = window.Utils ? window.Utils.slugify(category.id || label) : label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const id = baseId.slice(0, 80);
      const icon = String(category.icon || '🍴').trim().slice(0, 16) || '🍴';
      const color = /^#[0-9a-f]{6}$/i.test(String(category.color || '')) ? category.color : '#E85D3A';
      if (!id || !label || reserved.has(id) || seen.has(id)) return null;
      seen.add(id);
      return { id, label, icon, color, isCustom: true };
    }).filter(Boolean);
  },

  _normalizeImportedRecipe(recipe, allowedCategories) {
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return null;

    const asString = (value, max) => value === undefined || value === null ? '' : String(value).trim().slice(0, max);
    const asInteger = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) && Number.isInteger(number) ? number : fallback;
    };
    const limits = window.Recipes ? window.Recipes.LIMITS : {
      name: 120, description: 2000, notes: 4000, storage: 1000, ingredients: 100,
      ingredientName: 160, ingredientQuantity: 50, ingredientNotes: 500,
      steps: 100, stepText: 2000, stepNotes: 1000
    };

    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients.slice(0, limits.ingredients).map(ingredient => {
      if (!ingredient || typeof ingredient !== 'object' || Array.isArray(ingredient)) return null;
      return {
        name: asString(ingredient.name, limits.ingredientName),
        quantity: asString(ingredient.quantity, limits.ingredientQuantity),
        unit: asString(ingredient.unit, 30),
        notes: asString(ingredient.notes, limits.ingredientNotes)
      };
    }).filter(Boolean) : [];

    const steps = Array.isArray(recipe.steps) ? recipe.steps.slice(0, limits.steps).map(step => {
      if (typeof step === 'string') return { text: asString(step, limits.stepText), notes: '' };
      if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
      return {
        text: asString(step.text, limits.stepText),
        notes: asString(step.notes, limits.stepNotes)
      };
    }).filter(Boolean) : [];

    const rawImage = typeof recipe.image === 'string' ? recipe.image : '';
    const image = rawImage.length <= 7 * 1024 * 1024 &&
      /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(rawImage) ? rawImage : null;
    const category = allowedCategories.has(recipe.category) ? recipe.category : 'altro';
    const difficulty = ['facile', 'media', 'difficile'].includes(recipe.difficulty) ? recipe.difficulty : 'media';
    const importedId = typeof recipe.id === 'string' ? recipe.id.trim() : '';
    const id = /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(importedId) ? importedId : null;
    const now = Date.now();

    return {
      id,
      name: asString(recipe.name, limits.name),
      category,
      description: asString(recipe.description, limits.description),
      notes: asString(recipe.notes, limits.notes),
      storage: asString(recipe.storage, limits.storage),
      ingredients,
      steps,
      prepTime: asInteger(recipe.prepTime, 0),
      cookTime: asInteger(recipe.cookTime, 0),
      difficulty,
      servings: asInteger(recipe.servings, 4),
      image,
      imageThumbnail: null,
      isFavorite: recipe.isFavorite === true,
      createdAt: Number.isFinite(Number(recipe.createdAt)) ? Number(recipe.createdAt) : now,
      updatedAt: Number.isFinite(Number(recipe.updatedAt)) ? Number(recipe.updatedAt) : now
    };
  },

  _recipeFingerprint(recipe) {
    return JSON.stringify({
      name: String(recipe.name || '').toLocaleLowerCase('it-IT'),
      category: recipe.category || 'altro',
      description: recipe.description || '',
      notes: recipe.notes || '',
      storage: recipe.storage || '',
      ingredients: recipe.ingredients || [],
      steps: recipe.steps || [],
      prepTime: Number(recipe.prepTime) || 0,
      cookTime: Number(recipe.cookTime) || 0,
      difficulty: recipe.difficulty || 'media',
      servings: Number(recipe.servings) || 4
    });
  },

  _createFingerprintTracker(recipes) {
    const counts = new Map();
    const byId = new Map();
    const increment = fingerprint => {
      counts.set(fingerprint, (counts.get(fingerprint) || 0) + 1);
    };
    const decrement = fingerprint => {
      const next = (counts.get(fingerprint) || 0) - 1;
      if (next > 0) counts.set(fingerprint, next);
      else counts.delete(fingerprint);
    };

    recipes.forEach(recipe => {
      const fingerprint = this._recipeFingerprint(recipe);
      increment(fingerprint);
      if (recipe.id) byId.set(recipe.id, fingerprint);
    });

    return {
      has: fingerprint => counts.has(fingerprint),
      add: (id, fingerprint) => {
        increment(fingerprint);
        if (id) byId.set(id, fingerprint);
      },
      replace: (id, fingerprint) => {
        const previous = byId.get(id);
        if (previous !== undefined) decrement(previous);
        increment(fingerprint);
        byId.set(id, fingerprint);
      }
    };
  },

  _prepareImport(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') {
      throw new Error('Dati di importazione non validi: stringa JSON attesa');
    }
    if (new Blob([jsonString]).size > this.MAX_IMPORT_BYTES) {
      throw new Error('Il file supera il limite di 50 MB');
    }

    let data;
    try {
      data = JSON.parse(jsonString);
    } catch (e) {
      throw new Error('Formato JSON non valido: ' + e.message);
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Struttura dati non valida');
    }
    if (data.version !== undefined && (!Number.isInteger(Number(data.version)) || Number(data.version) > 2)) {
      throw new Error('Versione del backup non supportata');
    }

    let recipes;
    if (Array.isArray(data.recipes)) {
      recipes = data.recipes;
    } else if (Array.isArray(data)) {
      recipes = data;
    } else if (typeof data.name === 'string') {
      recipes = [data];
    } else {
      throw new Error('Nessuna ricetta trovata nei dati importati');
    }
    if (recipes.length > this.MAX_IMPORT_RECIPES) {
      throw new Error(`Il file contiene più di ${this.MAX_IMPORT_RECIPES} ricette`);
    }

    const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
    const hasCustomCategories = settings.customCategories !== undefined || data.customCategories !== undefined;
    const hasThemeMode = settings.themeMode !== undefined;
    const hasThemePalette = settings.themePalette !== undefined;
    const customCategories = this._parseCustomCategories(
      settings.customCategories !== undefined ? settings.customCategories : data.customCategories
    );
    const allowedCategories = new Set(this.BUILTIN_CATEGORY_IDS);
    customCategories.forEach(category => allowedCategories.add(category.id));

    const importedCategoryIds = new Set(customCategories.map(category => category.id));
    const normalized = recipes.map(recipe => this._normalizeImportedRecipe(recipe, allowedCategories)).filter(recipe => {
      if (!recipe) return false;
      if (!window.Recipes) return true;
      const validationRecipe = importedCategoryIds.has(recipe.category)
        ? { ...recipe, category: 'altro' }
        : recipe;
      return window.Recipes.validate(validationRecipe).valid;
    });
    const validPalettes = new Set(['classico', 'oceano', 'bosco', 'tramonto', 'ametista', 'autunno', 'zafferano']);

    return {
      recipes: normalized,
      rejected: recipes.length - normalized.length,
      settings: {
        customCategories: JSON.stringify(customCategories),
        themeMode: settings.themeMode === 'dark' || settings.themeMode === 'light' ? settings.themeMode : null,
        themePalette: validPalettes.has(settings.themePalette) ? settings.themePalette : null
      },
      settingPresence: { hasCustomCategories, hasThemeMode, hasThemePalette },
      customCategories,
      isBackup: Array.isArray(data.recipes)
    };
  },

  async previewImport(jsonString) {
    const prepared = this._prepareImport(jsonString);
    const existing = await this.getRecipeSummaries();
    const ids = new Set(existing.map(recipe => recipe.id));
    const existingById = new Map(existing.map(recipe => [recipe.id, recipe]));
    const fingerprints = this._createFingerprintTracker(existing);
    let additions = 0;
    let updates = 0;
    let duplicates = 0;
    let conflicts = 0;

    prepared.recipes.forEach(recipe => {
      const fingerprint = this._recipeFingerprint(recipe);
      if (recipe.id && ids.has(recipe.id)) {
        const current = existingById.get(recipe.id);
        const currentFingerprint = this._recipeFingerprint(current);
        if (currentFingerprint === fingerprint) {
          duplicates++;
          return;
        }
        if (Number(recipe.updatedAt) < Number(current.updatedAt)) {
          conflicts++;
          return;
        }
        fingerprints.replace(recipe.id, fingerprint);
        existingById.set(recipe.id, recipe);
        updates++;
      } else if (fingerprints.has(fingerprint)) {
        duplicates++;
      } else {
        fingerprints.add(recipe.id, fingerprint);
        if (recipe.id) {
          ids.add(recipe.id);
          existingById.set(recipe.id, recipe);
        }
        additions++;
      }
    });

    return {
      total: prepared.recipes.length,
      additions,
      updates,
      duplicates,
      conflicts,
      rejected: prepared.rejected,
      categories: prepared.customCategories.length,
      isBackup: prepared.isBackup
    };
  },

  /**
   * Import recipes and supported settings in one atomic transaction.
   * mode "merge" updates matching IDs and skips content duplicates.
   * mode "replace" replaces the whole recipe store.
   */
  async importData(jsonString, options = {}) {
    const prepared = this._prepareImport(jsonString);
    const mode = options.mode === 'replace' ? 'replace' : 'merge';
    if (prepared.recipes.length === 0 && prepared.rejected > 0) {
      throw new Error('Nessuna ricetta valida trovata nel file');
    }

    const db = await this._ensureDB();
    const existing = mode === 'merge' ? await this.getRecipeSummaries() : [];
    const existingIds = new Set(existing.map(recipe => recipe.id));
    const existingById = new Map(existing.map(recipe => [recipe.id, recipe]));
    const fingerprints = this._createFingerprintTracker(existing);
    const importedRecipes = [];
    for (const recipe of prepared.recipes) {
      importedRecipes.push({
        recipe,
        thumbnail: await this._createThumbnail(recipe.image)
      });
    }
    const tx = db.transaction(['recipes', 'images', 'settings'], 'readwrite');
    const store = tx.objectStore('recipes');
    const imageStore = tx.objectStore('images');
    const settingsStore = tx.objectStore('settings');
    const summary = {
      imported: 0,
      updated: 0,
      skipped: 0,
      conflicts: 0,
      rejected: prepared.rejected,
      categories: prepared.customCategories.length
    };

    if (mode === 'replace') {
      store.clear();
      imageStore.clear();
    }

    for (const item of importedRecipes) {
      const recipe = item.recipe;
      const fingerprint = this._recipeFingerprint(recipe);
      if (mode === 'merge' && recipe.id && existingIds.has(recipe.id)) {
        const current = existingById.get(recipe.id);
        const currentFingerprint = this._recipeFingerprint(current);
        if (currentFingerprint === fingerprint) {
          summary.skipped++;
          continue;
        }
        if (Number(recipe.updatedAt) < Number(current.updatedAt)) {
          summary.conflicts++;
          continue;
        }
        const updated = this._toStoredRecipe(recipe, item.thumbnail);
        store.put(updated.stored);
        if (updated.fullImage) {
          imageStore.put({ recipeId: recipe.id, data: updated.fullImage });
        } else {
          imageStore.delete(recipe.id);
        }
        fingerprints.replace(recipe.id, fingerprint);
        existingById.set(recipe.id, recipe);
        summary.updated++;
        continue;
      }
      if (mode === 'merge' && fingerprints.has(fingerprint)) {
        summary.skipped++;
        continue;
      }

      const id = recipe.id && !existingIds.has(recipe.id)
        ? recipe.id
        : (window.Utils ? window.Utils.generateId() : (crypto.randomUUID ? crypto.randomUUID() : this._fallbackId()));
      const addedRecipe = { ...recipe, id };
      const added = this._toStoredRecipe(addedRecipe, item.thumbnail);
      store.put(added.stored);
      if (added.fullImage) {
        imageStore.put({ recipeId: id, data: added.fullImage });
      }
      existingIds.add(id);
      existingById.set(id, addedRecipe);
      fingerprints.add(id, fingerprint);
      summary.imported++;
    }

    if (prepared.settingPresence.hasCustomCategories) {
      settingsStore.put({ key: 'customCategories', value: prepared.settings.customCategories });
    }
    if (prepared.settingPresence.hasThemeMode && prepared.settings.themeMode) {
      settingsStore.put({ key: 'themeMode', value: prepared.settings.themeMode });
    }
    if (prepared.settingPresence.hasThemePalette && prepared.settings.themePalette) {
      settingsStore.put({ key: 'themePalette', value: prepared.settings.themePalette });
    }
    await this._txComplete(tx);

    return summary;
  },

  /**
   * Fallback ID generator when crypto.randomUUID is not available.
   * @returns {string}
   */
  _fallbackId() {
    const segments = [8, 4, 4, 4, 12];
    const hex = '0123456789abcdef';
    return segments.map(len => {
      let s = '';
      for (let i = 0; i < len; i++) {
        s += hex[Math.floor(Math.random() * 16)];
      }
      return s;
    }).join('-');
  }
};
