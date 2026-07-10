/**
 * Sapori — Utility Functions Module
 * General-purpose helpers used across the app.
 */
window.Utils = {

  /**
   * Generate a unique ID.
   * Uses crypto.randomUUID() with a manual fallback.
   * @returns {string}
   */
  generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback: manual UUID v4 generation
    const hex = '0123456789abcdef';
    const segments = [8, 4, 4, 4, 12];
    return segments.map(len => {
      let s = '';
      for (let i = 0; i < len; i++) {
        s += hex[Math.floor(Math.random() * 16)];
      }
      return s;
    }).join('-');
  },

  /**
   * Format a timestamp to Italian locale date string.
   * Example: "10 luglio 2026"
   * @param {number} timestamp
   * @returns {string}
   */
  formatDate(timestamp) {
    if (!timestamp || typeof timestamp !== 'number') return '-';
    try {
      return new Intl.DateTimeFormat('it-IT', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(new Date(timestamp));
    } catch (e) {
      return new Date(timestamp).toLocaleDateString('it-IT');
    }
  },

  /**
   * Format a timestamp to Italian locale date + time string.
   * Example: "10 luglio 2026, 15:30"
   * @param {number} timestamp
   * @returns {string}
   */
  formatDateTime(timestamp) {
    if (!timestamp || typeof timestamp !== 'number') return '-';
    try {
      return new Intl.DateTimeFormat('it-IT', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(timestamp));
    } catch (e) {
      return new Date(timestamp).toLocaleString('it-IT');
    }
  },

  /**
   * Standard debounce implementation.
   * @param {Function} fn - Function to debounce
   * @param {number} delay - Delay in milliseconds
   * @returns {Function}
   */
  debounce(fn, delay = 300) {
    let timeoutId = null;
    const debounced = function (...args) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        timeoutId = null;
        fn.apply(this, args);
      }, delay);
    };
    debounced.cancel = function () {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    return debounced;
  },

  /**
   * Show a toast notification.
   * Creates a toast element, appends to #toast-container, auto-dismisses after 3s.
   * @param {string} message - Toast message text
   * @param {'info'|'success'|'error'} type - Toast type
   */
  showToast(message, type = 'info') {
    // Ensure container exists
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast--${type} animate-slide-up`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    // Icon based on type
    const icons = {
      success: '✓',
      error: '✗',
      info: 'ℹ'
    };
    const icon = icons[type] || icons.info;

    toast.innerHTML = `<span class="toast__icon">${icon}</span><span class="toast__message">${this.escapeHtml(message)}</span>`;

    container.appendChild(toast);

    // Auto-dismiss after 3 seconds
    const dismissTimeout = setTimeout(() => {
      this._dismissToast(toast);
    }, 3000);

    // Allow manual dismiss on click
    toast.addEventListener('click', () => {
      clearTimeout(dismissTimeout);
      this._dismissToast(toast);
    }, { once: true });
  },

  /**
   * Dismiss a toast element with fade-out animation.
   * @param {HTMLElement} toast
   */
  _dismissToast(toast) {
    if (!toast || !toast.parentNode) return;

    toast.classList.add('toast--fade-out');
    toast.addEventListener('animationend', () => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, { once: true });

    // Fallback removal if animationend doesn't fire
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 500);
  },

  /**
   * Compress an image file to a base64 JPEG data URL.
   * Resizes to maxWidth while maintaining aspect ratio.
   * @param {File} file - Image file
   * @param {number} maxWidth - Maximum width in pixels
   * @returns {Promise<string>} Base64 data URL
   */
  async compressImage(file, maxWidth = 800) {
    if (!file || !(file instanceof Blob)) {
      throw new Error('File immagine non valido');
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => reject(new Error('Errore nella lettura del file immagine'));

      reader.onload = (e) => {
        const img = new Image();

        img.onerror = () => reject(new Error('Errore nel caricamento dell\'immagine'));

        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            let width = img.naturalWidth;
            let height = img.naturalHeight;

            // Scale down if wider than maxWidth
            if (width > maxWidth) {
              height = Math.round(height * (maxWidth / width));
              width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('Impossibile creare il contesto canvas'));
              return;
            }

            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            resolve(dataUrl);
          } catch (err) {
            reject(new Error('Errore nella compressione dell\'immagine: ' + err.message));
          }
        };

        img.src = e.target.result;
      };

      reader.readAsDataURL(file);
    });
  },

  /**
   * Format minutes into a readable Italian time string.
   * @param {number} minutes
   * @returns {string}
   */
  formatTime(minutes) {
    if (minutes === null || minutes === undefined || minutes === 0 || typeof minutes !== 'number' || isNaN(minutes)) {
      return '-';
    }

    const mins = Math.max(0, Math.round(minutes));

    if (mins === 0) return '-';

    if (mins < 60) {
      return `${mins} min`;
    }

    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;

    if (remainingMins === 0) {
      return `${hours}h`;
    }

    return `${hours}h ${remainingMins}min`;
  },

  /**
   * Escape HTML special characters to prevent XSS.
   * @param {string} str
   * @returns {string}
   */
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return s.replace(/[&<>"']/g, (ch) => map[ch]);
  },

  /**
   * Convert a string to a URL-safe slug.
   * Lowercase, replace spaces with hyphens, remove special chars, handle Italian accents.
   * @param {string} str
   * @returns {string}
   */
  slugify(str) {
    if (!str || typeof str !== 'string') return '';

    // Normalize Unicode and strip combining diacritical marks
    let slug = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    return slug
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')  // Remove non-alphanumeric (except spaces and hyphens)
      .replace(/[\s_]+/g, '-')         // Replace spaces/underscores with hyphens
      .replace(/-+/g, '-')             // Collapse consecutive hyphens
      .replace(/^-|-$/g, '');          // Trim leading/trailing hyphens
  },

  /**
   * Get total time (prep + cook) as a formatted string.
   * @param {number} prepTime - Prep time in minutes
   * @param {number} cookTime - Cook time in minutes
   * @returns {string}
   */
  getTotalTime(prepTime, cookTime) {
    const prep = (typeof prepTime === 'number' && !isNaN(prepTime)) ? Math.max(0, prepTime) : 0;
    const cook = (typeof cookTime === 'number' && !isNaN(cookTime)) ? Math.max(0, cookTime) : 0;
    const total = prep + cook;

    return this.formatTime(total);
  },

  /**
   * Get an emoji representing the difficulty level.
   * @param {string} difficulty
   * @returns {string}
   */
  getDifficultyEmoji(difficulty) {
    const map = {
      'facile': '🟢',
      'media': '🟡',
      'difficile': '🔴'
    };
    return map[difficulty] || '🟡';
  },

  /**
   * Get category info object by category ID.
   * Falls back to the 'altro' category if not found.
   * @param {string} categoryId
   * @returns {{id: string, label: string, icon: string, color: string}}
   */
  getCategoryInfo(categoryId) {
    const defaultCategory = { id: 'altro', label: 'Altro', icon: '🍴', color: '#FFD43B' };

    if (!categoryId || typeof categoryId !== 'string') {
      return defaultCategory;
    }

    if (window.Recipes && Array.isArray(window.Recipes.CATEGORIES)) {
      const found = window.Recipes.CATEGORIES.find(c => c.id === categoryId);
      return found || defaultCategory;
    }

    return defaultCategory;
  },

  /**
   * Trigger a file download in the browser.
   * @param {string} content - File content
   * @param {string} filename - Download filename
   * @param {string} mimeType - MIME type
   */
  triggerDownload(content, filename, mimeType = 'application/json') {
    try {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';

      document.body.appendChild(link);
      link.click();

      // Cleanup
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (e) {
      throw new Error('Errore durante il download: ' + e.message);
    }
  },

  /**
   * Read a File object as text.
   * @param {File} file
   * @returns {Promise<string>}
   */
  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      if (!file || !(file instanceof Blob)) {
        reject(new Error('File non valido'));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Errore nella lettura del file: ' + (reader.error ? reader.error.message : 'sconosciuto')));
      reader.readAsText(file, 'UTF-8');
    });
  }
};
