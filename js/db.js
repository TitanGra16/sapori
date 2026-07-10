/**
 * Sapori — IndexedDB Storage Module
 * Database: SaporiDB v1
 * Stores: recipes (keyPath: id), settings (keyPath: key)
 */
window.DB = {
  db: null,

  /**
   * Initialize the IndexedDB database.
   * Creates object stores and indexes on first run.
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SaporiDB', 1);

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
      };

      request.onsuccess = () => {
        this.db = request.result;

        // Handle unexpected close (e.g. version change from another tab)
        this.db.onclose = () => {
          this.db = null;
        };

        resolve(this.db);
      };
    });
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
    const tx = db.transaction('recipes', 'readonly');
    const store = tx.objectStore('recipes');
    const recipes = await this._promisify(store.getAll());

    // Sort by createdAt descending
    recipes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return recipes;
  },

  /**
   * Get a single recipe by its ID.
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  async getRecipe(id) {
    if (!id) return undefined;

    const db = await this._ensureDB();
    const tx = db.transaction('recipes', 'readonly');
    const store = tx.objectStore('recipes');
    return this._promisify(store.get(id));
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

    const tx = db.transaction('recipes', 'readwrite');
    const store = tx.objectStore('recipes');
    store.add(newRecipe);
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

    const tx = db.transaction('recipes', 'readwrite');
    const store = tx.objectStore('recipes');
    store.put(updatedRecipe);
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
    const tx = db.transaction('recipes', 'readwrite');
    const store = tx.objectStore('recipes');
    store.delete(id);
    await this._txComplete(tx);
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

  /**
   * Export all recipes as a JSON string with metadata.
   * @returns {Promise<string>}
   */
  async exportData() {
    const recipes = await this.getAllRecipes();

    const exportPayload = {
      appName: 'Sapori',
      version: 1,
      exportDate: new Date().toISOString(),
      recipeCount: recipes.length,
      recipes: recipes
    };

    return JSON.stringify(exportPayload, null, 2);
  },

  /**
   * Import recipes from a JSON string.
   * Validates the structure and generates new IDs to avoid conflicts.
   * @param {string} jsonString
   * @returns {Promise<number>} Count of imported recipes
   * @throws {Error} On invalid data
   */
  async importData(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') {
      throw new Error('Dati di importazione non validi: stringa JSON attesa');
    }

    let data;
    try {
      data = JSON.parse(jsonString);
    } catch (e) {
      throw new Error('Formato JSON non valido: ' + e.message);
    }

    // Validate top-level structure
    if (!data || typeof data !== 'object') {
      throw new Error('Struttura dati non valida');
    }

    // Accept both { recipes: [...] } and plain arrays
    let recipes;
    if (Array.isArray(data.recipes)) {
      recipes = data.recipes;
    } else if (Array.isArray(data)) {
      recipes = data;
    } else {
      throw new Error('Nessuna ricetta trovata nei dati importati');
    }

    if (recipes.length === 0) {
      return 0;
    }

    const db = await this._ensureDB();
    const tx = db.transaction('recipes', 'readwrite');
    const store = tx.objectStore('recipes');
    const now = Date.now();
    let importCount = 0;

    for (const recipe of recipes) {
      // Basic validation: must have at least a name
      if (!recipe || typeof recipe !== 'object' || !recipe.name || typeof recipe.name !== 'string') {
        continue; // Skip invalid entries
      }

      const importedRecipe = {
        id: window.Utils ? window.Utils.generateId() : (crypto.randomUUID ? crypto.randomUUID() : this._fallbackId()),
        name: recipe.name || '',
        category: recipe.category || 'altro',
        description: recipe.description || '',
        ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
        steps: Array.isArray(recipe.steps) ? recipe.steps : [],
        prepTime: typeof recipe.prepTime === 'number' ? recipe.prepTime : 0,
        cookTime: typeof recipe.cookTime === 'number' ? recipe.cookTime : 0,
        difficulty: recipe.difficulty || 'media',
        servings: typeof recipe.servings === 'number' && recipe.servings > 0 ? recipe.servings : 4,
        image: recipe.image || null,
        isFavorite: typeof recipe.isFavorite === 'boolean' ? recipe.isFavorite : false,
        createdAt: typeof recipe.createdAt === 'number' ? recipe.createdAt : now,
        updatedAt: now
      };

      store.add(importedRecipe);
      importCount++;
    }

    await this._txComplete(tx);

    return importCount;
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
