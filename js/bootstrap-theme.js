(function () {
  'use strict';

  var mode = window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  var palette = 'classico';
  var allowedPalettes = [
    'classico',
    'oceano',
    'bosco',
    'tramonto',
    'ametista',
    'autunno',
    'zafferano'
  ];

  try {
    var savedMode = window.localStorage.getItem('sapori-theme');
    var savedPalette = window.localStorage.getItem('sapori-palette');
    if (savedMode === 'light' || savedMode === 'dark') mode = savedMode;
    if (allowedPalettes.indexOf(savedPalette) !== -1) palette = savedPalette;
  } catch (error) {
    // System preferences remain a safe fallback when storage is unavailable.
  }

  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.setAttribute('data-palette', palette);
})();
