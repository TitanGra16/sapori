/**
 * Sapori — Theme Management Module
 * Handles dark/light mode and color palette switching.
 * Persists preferences via the DB settings store.
 */
window.Theme = {
  currentMode: 'light',
  currentPalette: 'classico',

  /**
   * Color map for theme-color meta tag.
   * Keyed by palette, then by mode.
   */
  _themeColors: {
    classico: { light: '#E85D3A', dark: '#FF7F5C' },
    oceano:   { light: '#0EA5E9', dark: '#38BDF8' },
    bosco:    { light: '#16A34A', dark: '#4ADE80' },
    tramonto: { light: '#DB2777', dark: '#F472B6' }
  },

  /**
   * Initialize theme from saved preferences or system defaults.
   * Must be called after DB.init().
   */
  async init() {
    try {
      // Load saved mode
      const savedMode = await window.DB.getSetting('themeMode');
      if (savedMode === 'light' || savedMode === 'dark') {
        this.currentMode = savedMode;
      } else {
        // Detect system preference
        this.currentMode = this._detectSystemPreference();
      }

      // Load saved palette
      const savedPalette = await window.DB.getSetting('themePalette');
      if (savedPalette && this._themeColors[savedPalette]) {
        this.currentPalette = savedPalette;
      } else {
        this.currentPalette = 'classico';
      }
    } catch (e) {
      // If DB isn't ready, use defaults + system preference
      console.warn('Tema: impossibile caricare le preferenze salvate, uso i valori predefiniti.', e);
      this.currentMode = this._detectSystemPreference();
      this.currentPalette = 'classico';
    }

    // Apply to DOM
    this.apply();

    // Listen for system theme changes
    this._listenSystemChanges();
  },

  /**
   * Detect system dark mode preference.
   * @returns {'light'|'dark'}
   */
  _detectSystemPreference() {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  },

  /**
   * Listen for changes to the system color scheme.
   * Only applies if the user hasn't set a manual preference.
   */
  _listenSystemChanges() {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = async (e) => {
        // Only auto-switch if user hasn't explicitly set a preference
        const savedMode = await window.DB.getSetting('themeMode').catch(() => null);
        if (savedMode === null || savedMode === undefined) {
          this.currentMode = e.matches ? 'dark' : 'light';
          this.apply();
        }
      };

      // addEventListener is preferred over deprecated addListener
      if (mq.addEventListener) {
        mq.addEventListener('change', handler);
      } else if (mq.addListener) {
        mq.addListener(handler);
      }
    } catch (e) {
      // Non-critical, ignore
    }
  },

  /**
   * Toggle between light and dark mode.
   * Saves the preference and applies it.
   * @returns {Promise<string>} The new mode ('light' or 'dark')
   */
  async toggleDarkMode() {
    this.currentMode = this.currentMode === 'light' ? 'dark' : 'light';
    this.apply();

    try {
      await window.DB.setSetting('themeMode', this.currentMode);
    } catch (e) {
      console.warn('Tema: impossibile salvare la preferenza modalità.', e);
    }

    return this.currentMode;
  },

  /**
   * Set the color palette.
   * @param {string} paletteName - One of: 'classico', 'oceano', 'bosco', 'tramonto'
   * @returns {Promise<void>}
   */
  async setPalette(paletteName) {
    // Validate palette name
    if (!paletteName || !this._themeColors[paletteName]) {
      console.warn(`Tema: palette "${paletteName}" non valida, uso "classico".`);
      paletteName = 'classico';
    }

    this.currentPalette = paletteName;
    this.apply();

    try {
      await window.DB.setSetting('themePalette', this.currentPalette);
    } catch (e) {
      console.warn('Tema: impossibile salvare la preferenza palette.', e);
    }
  },

  /**
   * Apply the current theme mode and palette to the DOM.
   * Sets data-theme and data-palette attributes on <html>.
   * Updates <meta name="theme-color">.
   */
  apply() {
    const root = document.documentElement;

    // Set data attributes
    root.setAttribute('data-theme', this.currentMode);
    root.setAttribute('data-palette', this.currentPalette);

    // Update meta theme-color
    this._updateMetaThemeColor();
  },

  /**
   * Update the <meta name="theme-color"> tag.
   * Creates it if it doesn't exist.
   */
  _updateMetaThemeColor() {
    const color = this.getThemeColor();

    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }

    meta.setAttribute('content', color);
  },

  /**
   * Get the current theme info.
   * @returns {{mode: string, palette: string}}
   */
  getCurrentTheme() {
    return {
      mode: this.currentMode,
      palette: this.currentPalette
    };
  },

  /**
   * Get the current primary color for the meta theme-color tag.
   * Based on the current palette and mode.
   * @returns {string} Hex color
   */
  getThemeColor() {
    const paletteColors = this._themeColors[this.currentPalette] || this._themeColors.classico;
    return paletteColors[this.currentMode] || paletteColors.light;
  }
};
