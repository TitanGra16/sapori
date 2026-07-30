/**
 * Sapori — Utility Functions Module
 * General-purpose helpers used across the app.
 */
window.Utils = {
  MAX_IMAGE_FILE_BYTES: 12 * 1024 * 1024,
  MAX_IMAGE_PIXELS: 40 * 1000 * 1000,
  MAX_IMAGE_DATA_URL_LENGTH: 2500000,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],

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
   * @param {'info'|'success'|'warning'|'error'} type - Toast type
   */
  showToast(message, type = 'info') {
    const supportedTypes = ['info', 'success', 'warning', 'error'];
    const toastType = supportedTypes.includes(type) ? type : 'info';

    // Ensure container exists
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast--${toastType} animate-slide-up`;
    const isUrgent = toastType === 'warning' || toastType === 'error';
    toast.setAttribute('role', isUrgent ? 'alert' : 'status');
    toast.setAttribute('aria-live', isUrgent ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');

    // Icon based on type
    const icons = {
      success: '✓',
      warning: '⚠',
      error: '✗',
      info: 'ℹ'
    };
    const icon = icons[toastType];

    toast.innerHTML =
      `<span class="toast-icon" aria-hidden="true">${icon}</span>` +
      `<span class="toast-message">${this.escapeHtml(message)}</span>` +
      '<button type="button" class="toast-dismiss" aria-label="Chiudi notifica">×</button>';

    container.appendChild(toast);

    // Warnings and errors remain visible longer so they can be read comfortably.
    const dismissTimeout = setTimeout(() => {
      this._dismissToast(toast);
    }, isUrgent ? 6500 : 4000);

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
   * Compress an image file to a bounded base64 JPEG data URL.
   * Resizes both dimensions while maintaining aspect ratio.
   * @param {File} file - Image file
   * @param {number} maxDimension - Maximum width or height in pixels
   * @returns {Promise<string>} Base64 data URL
   */
  async compressImage(file, maxDimension = 1280) {
    if (!file || !(file instanceof Blob)) {
      throw new Error('File immagine non valido');
    }
    if (!this.ALLOWED_IMAGE_TYPES.includes(String(file.type || '').toLowerCase())) {
      throw new Error('Formato non supportato. Usa JPEG, PNG o WebP');
    }
    if (file.size > this.MAX_IMAGE_FILE_BYTES) {
      throw new Error('La foto supera il limite di 12 MB');
    }
    if (!Number.isFinite(maxDimension) || maxDimension < 320 || maxDimension > 2048) {
      throw new Error('Dimensione di compressione non valida');
    }

    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      const cleanup = () => URL.revokeObjectURL(objectUrl);

      image.onerror = () => {
        cleanup();
        reject(new Error('Il file non contiene un’immagine valida'));
      };

      image.onload = () => {
        cleanup();
        try {
          const sourceWidth = image.naturalWidth;
          const sourceHeight = image.naturalHeight;
          if (
            !sourceWidth ||
            !sourceHeight ||
            sourceWidth * sourceHeight > this.MAX_IMAGE_PIXELS
          ) {
            reject(new Error('La foto ha una risoluzione troppo elevata'));
            return;
          }

          const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
          const width = Math.max(1, Math.round(sourceWidth * scale));
          const height = Math.max(1, Math.round(sourceHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('Impossibile elaborare la foto'));
            return;
          }

          context.fillStyle = '#FFFFFF';
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);

          let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          if (dataUrl.length > this.MAX_IMAGE_DATA_URL_LENGTH) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.65);
          }
          if (
            !dataUrl.startsWith('data:image/jpeg;base64,') ||
            dataUrl.length > this.MAX_IMAGE_DATA_URL_LENGTH
          ) {
            reject(new Error('La foto resta troppo pesante dopo la compressione'));
            return;
          }

          resolve(dataUrl);
        } catch (error) {
          reject(new Error('Errore nella compressione dell’immagine: ' + error.message));
        }
      };

      image.src = objectUrl;
    });
  },

  /**
   * Create a small JPEG thumbnail from an already validated image data URL.
   * @param {string} dataUrl
   * @param {number} maxDimension
   * @param {number} maxDataUrlLength
   * @returns {Promise<string>}
   */
  async createImageThumbnail(
    dataUrl,
    maxDimension = 360,
    maxDataUrlLength = this.MAX_IMAGE_DATA_URL_LENGTH
  ) {
    const safeDataUrlLength = Number.isFinite(maxDataUrlLength)
      ? Math.min(7 * 1024 * 1024, Math.max(1, maxDataUrlLength))
      : this.MAX_IMAGE_DATA_URL_LENGTH;
    if (
      typeof dataUrl !== 'string' ||
      dataUrl.length > safeDataUrlLength ||
      !/^data:image\/(?:jpe?g|png|webp|gif);base64,/i.test(dataUrl)
    ) {
      throw new Error('Dati immagine non validi');
    }
    if (!Number.isFinite(maxDimension) || maxDimension < 64 || maxDimension > 1024) {
      throw new Error('Dimensione anteprima non valida');
    }

    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onerror = () => reject(new Error('Impossibile creare l’anteprima'));
      image.onload = () => {
        try {
          const sourceWidth = image.naturalWidth;
          const sourceHeight = image.naturalHeight;
          if (
            !sourceWidth ||
            !sourceHeight ||
            sourceWidth * sourceHeight > this.MAX_IMAGE_PIXELS
          ) {
            throw new Error('Risoluzione immagine non valida');
          }
          const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
          const width = Math.max(1, Math.round(sourceWidth * scale));
          const height = Math.max(1, Math.round(sourceHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas non disponibile');
          context.fillStyle = '#FFFFFF';
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        } catch (error) {
          reject(new Error('Impossibile creare l’anteprima: ' + error.message));
        }
      };
      image.src = dataUrl;
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
      await new Promise(resolve => {
        let completed = false;
        let fallbackTimer = null;
        const finish = () => {
          if (completed) return;
          completed = true;
          window.removeEventListener('afterprint', finish);
          if (fallbackTimer !== null) clearTimeout(fallbackTimer);
          resolve();
        };
        window.addEventListener('afterprint', finish, { once: true });

        const printSource = Function.prototype.toString.call(window.print);
        window.print();

        // I test e gli eventuali wrapper non nativi non aprono un vero dialogo.
        // Nei browser reali afterprint governa la pulizia, con un fallback per
        // le implementazioni che non emettono l'evento.
        if (!printSource.includes('[native code]')) {
          finish();
        } else {
          fallbackTimer = setTimeout(finish, 2000);
        }
      });
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

      // Safari può iniziare il download in modo differito: non revocare il
      // Blob nello stesso giro dell'evento click.
      setTimeout(() => {
        if (link.parentNode) link.parentNode.removeChild(link);
        URL.revokeObjectURL(url);
      }, 1000);
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
