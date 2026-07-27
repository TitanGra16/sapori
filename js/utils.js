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
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    // Icon based on type
    const icons = {
      success: '✓',
      error: '✗',
      info: 'ℹ'
    };
    const icon = icons[type] || icons.info;

    toast.innerHTML =
      `<span class="toast-icon" aria-hidden="true">${icon}</span>` +
      `<span class="toast-message">${this.escapeHtml(message)}</span>` +
      '<button type="button" class="toast-dismiss" aria-label="Chiudi notifica">×</button>';

    container.appendChild(toast);

    // Errors remain visible longer so they can be read comfortably.
    const dismissTimeout = setTimeout(() => {
      this._dismissToast(toast);
    }, type === 'error' ? 6500 : 4000);

    toast.querySelector('.toast-dismiss').addEventListener('click', () => {
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

    toast.classList.add('is-exiting');
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
   * Scale a quantity string by a given ratio.
   * Examples: "200" * 0.5 -> "100", "1.5" * 2 -> "3", "q.b." -> "q.b."
   * @param {string} qtyStr
   * @param {number} ratio
   * @returns {string}
   */
  scaleQuantity(qtyStr, ratio) {
    if (!qtyStr || typeof qtyStr !== 'string' || !ratio || ratio <= 0) return qtyStr || '';
    const trimmed = qtyStr.trim();
    if (!trimmed) return '';

    return trimmed.replace(/(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[\.,]\d+)?)/g, (match) => {
      let num;
      if (match.includes('/')) {
        const mixedParts = match.trim().split(/\s+/);
        const fraction = mixedParts.pop().split('/').map(Number);
        if (fraction.length !== 2 || !fraction[1]) return match;
        num = (mixedParts.length ? Number(mixedParts[0]) : 0) + fraction[0] / fraction[1];
      } else {
        num = parseFloat(match.replace(',', '.'));
      }
      if (!Number.isFinite(num)) return match;
      const scaled = num * ratio;
      const rounded = Math.round(scaled * 100) / 100;
      return match.includes(',') ? String(rounded).replace('.', ',') : String(rounded);
    });
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
      .replace(/[^a-z0-9\s_-]/g, '')  // Remove non-alphanumeric (except spaces, underscores, hyphens)
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
   * Pick an accessible foreground for a solid hexadecimal background.
   * @param {string} hexColor
   * @returns {'#030303'|'#FFFFFF'}
   */
  getContrastText(hexColor) {
    const match = /^#([0-9a-f]{6})$/i.exec(String(hexColor || '').trim());
    if (!match) return '#030303';

    const value = match[1];
    const channels = [0, 2, 4].map(index => {
      const channel = parseInt(value.slice(index, index + 2), 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    const darkLuminance = 0.00091;
    const darkContrast = (luminance + 0.05) / (darkLuminance + 0.05);
    const lightContrast = 1.05 / (luminance + 0.05);

    return darkContrast >= lightContrast ? '#030303' : '#FFFFFF';
  },

  /**
   * Wait until the resources inside a printable document are ready, then
   * invoke the browser print dialog and always restore the application UI.
   * The supplied root must already be attached to document.body.
   * @param {HTMLElement} printRoot
   * @param {string} bodyClass
   * @returns {Promise<void>}
   */
  async printDocument(printRoot, bodyClass) {
    if (!printRoot || !printRoot.parentNode || !bodyClass) {
      throw new Error('Documento di stampa non valido');
    }

    const imagePromises = Array.from(printRoot.querySelectorAll('img')).map(image => {
      if (typeof image.decode === 'function') {
        return image.decode().catch(() => undefined);
      }
      if (image.complete) return Promise.resolve();
      return new Promise(resolve => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
    });

    const fontPromise = document.fonts && document.fonts.ready
      ? document.fonts.ready.catch(() => undefined)
      : Promise.resolve();

    document.body.classList.add(bodyClass);
    try {
      await Promise.all([fontPromise, Promise.all(imagePromises)]);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.print();
    } finally {
      document.body.classList.remove(bodyClass);
      if (printRoot.parentNode) printRoot.parentNode.removeChild(printRoot);
    }
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
