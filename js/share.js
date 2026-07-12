(function (window) {
  'use strict';

  var Share = {
    // Gradient definitions corresponding to theme palettes
    _gradients: {
      classico:  ['#E85D3A', '#FFA726'],
      oceano:    ['#0EA5E9', '#06B6D4'],
      bosco:     ['#16A34A', '#84CC16'],
      tramonto:  ['#DB2777', '#EC4899'],
      ametista:  ['#8B5CF6', '#A78BFA'],
      autunno:   ['#8C5A3C', '#F5BE94'],
      zafferano: ['#D97706', '#FBBF24']
    },

    /**
     * Generate the Share Card as a Canvas and show the Share Modal
     * @param {Object} recipe - The recipe object to share
     */
    async openShareMenu(recipe) {
      Utils.showToast('Generazione cartolina in corso... 🎨', 'info');
      try {
        var dataUrl = await this.generateCardDataURL(recipe);
        this._showShareModal(recipe, dataUrl);
      } catch (e) {
        console.error('Errore nella generazione della cartolina:', e);
        Utils.showToast('Impossibile generare la cartolina di condivisione', 'error');
      }
    },

    /**
     * Draw the recipe card on a canvas and return its base64 PNG data URL
     * @param {Object} recipe
     * @returns {Promise<string>}
     */
    generateCardDataURL(recipe) {
      var self = this;
      return new Promise(function (resolve, reject) {
        var canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 1000;
        var ctx = canvas.getContext('2d');

        // Get active theme settings
        var activeTheme = window.Theme ? window.Theme.getCurrentTheme() : { mode: 'light', palette: 'classico' };
        var palette = activeTheme.palette || 'classico';
        var isDark = activeTheme.mode === 'dark';

        // Colors
        var gradColors = self._gradients[palette] || self._gradients.classico;
        var cardBg = isDark ? '#1e1e1e' : '#ffffff';
        var textColor = isDark ? '#ffffff' : '#1e1e1e';
        var textMuted = isDark ? '#aaaaaa' : '#666666';
        var borderCol = isDark ? '#333333' : '#e0e0e0';

        // 1. Draw outer gradient background
        var bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        bgGrad.addColorStop(0, gradColors[0]);
        bgGrad.addColorStop(1, gradColors[1]);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Draw brand header
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🍴 SAPORI — IL TUO RICETTARIO', canvas.width / 2, 50);

        // 3. Draw central card background (rounded rectangle)
        var cardX = 50;
        var cardY = 80;
        var cardW = 700;
        var cardH = 840;
        self._drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 24, cardBg);

        // 4. Load and draw recipe image
        var imageY = cardY + 30;
        var imageH = 340;
        var imageW = cardW - 60;
        var imageX = cardX + 30;

        var img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = function () {
          // Draw image cropped & centered with rounded corners
          ctx.save();
          self._drawRoundedRectPath(ctx, imageX, imageY, imageW, imageH, 16);
          ctx.clip();
          
          var imgRatio = img.width / img.height;
          var containerRatio = imageW / imageH;
          var drawW, drawH, drawX, drawY;

          if (imgRatio > containerRatio) {
            drawH = imageH;
            drawW = imageH * imgRatio;
            drawX = imageX - (drawW - imageW) / 2;
            drawY = imageY;
          } else {
            drawW = imageW;
            drawH = imageW / imgRatio;
            drawX = imageX;
            drawY = imageY - (drawH - imageH) / 2;
          }
          ctx.drawImage(img, drawX, drawY, drawW, drawH);
          ctx.restore();

          // Continue drawing texts after image loads
          self._drawCardDetails(ctx, recipe, cardX, cardY, cardW, cardH, imageY + imageH + 30, textColor, textMuted, borderCol);
          resolve(canvas.toDataURL('image/png'));
        };

        img.onerror = function () {
          // Fallback if image fails to load or does not exist
          ctx.fillStyle = isDark ? '#2e2e2e' : '#f5f5f5';
          self._drawRoundedRect(ctx, imageX, imageY, imageW, imageH, 16, ctx.fillStyle);
          
          ctx.fillStyle = textMuted;
          ctx.font = '64px system-ui, sans-serif';
          ctx.fillText('🍳', imageX + imageW / 2, imageY + imageH / 2 + 10);
          
          ctx.font = '16px system-ui, sans-serif';
          ctx.fillText('Nessuna foto disponibile', imageX + imageW / 2, imageY + imageH / 2 + 50);

          // Continue drawing texts
          self._drawCardDetails(ctx, recipe, cardX, cardY, cardW, cardH, imageY + imageH + 30, textColor, textMuted, borderCol);
          resolve(canvas.toDataURL('image/png'));
        };

        // Trigger image load (use default placeholder if empty)
        img.src = recipe.image || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      });
    },

    /**
     * Draw text details inside the card
     */
    _drawCardDetails(ctx, recipe, cardX, cardY, cardW, cardH, startY, textColor, textMuted, borderCol) {
      var self = this;
      ctx.textAlign = 'left';

      // Category tag (Pill)
      var cat = window.Recipes ? window.Recipes.CATEGORIES.find(c => c.id === recipe.category) : null;
      var catLabel = (cat ? cat.icon + ' ' + cat.label : 'Cucina').toUpperCase();
      
      ctx.fillStyle = 'rgba(232, 93, 58, 0.15)';
      self._drawRoundedRect(ctx, cardX + 30, startY, 150, 32, 8, ctx.fillStyle);
      
      ctx.fillStyle = '#E85D3A';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(catLabel, cardX + 30 + 75, startY + 20);

      // Recipe Title
      ctx.textAlign = 'left';
      ctx.fillStyle = textColor;
      ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
      var titleY = startY + 80;
      var titleHeight = self._drawTextWrapped(ctx, recipe.name, cardX + 30, titleY, cardW - 60, 42);

      // Divider line
      var dividerY = titleY + titleHeight + 10;
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cardX + 30, dividerY);
      ctx.lineTo(cardX + cardW - 30, dividerY);
      ctx.stroke();

      // Meta Info Grid (Prep time, Cook time, Difficulty, Servings)
      var metaY = dividerY + 35;
      ctx.font = '16px system-ui, sans-serif';
      
      // Items list
      var metaItems = [
        { label: 'Preparazione', val: (recipe.prepTime || '0') + ' min', icon: '⏱️' },
        { label: 'Cottura', val: (recipe.cookTime || '0') + ' min', icon: '🍳' },
        { label: 'Porzioni', val: (recipe.servings || '4') + ' pers.', icon: '👥' },
        { label: 'Difficoltà', val: self._getDifficultyLabel(recipe.difficulty), icon: '⭐' }
      ];

      var colW = (cardW - 60) / 4;
      metaItems.forEach(function (item, idx) {
        var x = cardX + 30 + (idx * colW) + 10;
        
        ctx.fillStyle = textMuted;
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillText(item.label, x, metaY);
        
        ctx.fillStyle = textColor;
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.fillText(item.icon + ' ' + item.val, x, metaY + 24);
      });

      // Divider line 2
      var divider2Y = metaY + 50;
      ctx.strokeStyle = borderCol;
      ctx.beginPath();
      ctx.moveTo(cardX + 30, divider2Y);
      ctx.lineTo(cardX + cardW - 30, divider2Y);
      ctx.stroke();

      // Ingredients preview title
      var ingTitleY = divider2Y + 40;
      ctx.fillStyle = textColor;
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText('INGREDIENTI PRINCIPALI', cardX + 30, ingTitleY);

      // Ingredients list
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillStyle = textMuted;
      var ingY = ingTitleY + 30;
      
      if (recipe.ingredients && recipe.ingredients.length > 0) {
        var maxIng = 4;
        var shown = recipe.ingredients.slice(0, maxIng);
        shown.forEach(function (ing, idx) {
          var ingText = '• ' + ing.name;
          if (ing.quantity) ingText += ' (' + ing.quantity + ' ' + (ing.unit || '') + ')';
          ctx.fillText(ingText, cardX + 30, ingY + (idx * 28));
        });

        if (recipe.ingredients.length > maxIng) {
          ctx.fillText('• ... e altri ' + (recipe.ingredients.length - maxIng) + ' ingredienti', cardX + 30, ingY + (maxIng * 28));
        }
      } else {
        ctx.fillText('Nessun ingrediente elencato', cardX + 30, ingY);
      }

      // App Promo watermark
      ctx.fillStyle = '#E85D3A';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Cucina con Sapori App 📱', cardX + cardW - 30, cardY + cardH - 30);
    },

    /**
     * Show preview modal dialog for the generated share card
     */
    _showShareModal(recipe, dataUrl) {
      var self = this;
      var overlay = document.getElementById('modal-overlay');
      if (!overlay) return;

      overlay.innerHTML =
        '<div class="modal animate-slide-up" style="max-width: 500px;">' +
          '<div class="modal__header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:12px;">' +
            '<h3 style="margin:0;">Condividi Ricetta</h3>' +
            '<button type="button" class="btn btn--icon" data-action="modal-cancel" style="width:32px; height:32px; display:flex; align-items:center; justify-content:center; border-radius:50%; border:none; background:transparent; cursor:pointer;">' + Icons.x + '</button>' +
          '</div>' +
          '<div class="modal__body" style="text-align:center; padding:10px 0;">' +
            '<p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:12px;">Ecco la tua cartolina pronta! Tieni premuto sull\'immagine per salvarla o usa i pulsanti sotto.</p>' +
            '<div class="share-card-preview-wrapper" style="box-shadow:var(--shadow-lg); border-radius:12px; overflow:hidden; display:inline-block; border:1px solid var(--border); max-width:100%;">' +
              '<img src="' + dataUrl + '" alt="Cartolina Condivisione" style="display:block; max-width:100%; max-height:420px; object-fit:contain;">' +
            '</div>' +
          '</div>' +
          '<div class="modal__footer" style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:16px;">' +
            '<button type="button" class="btn btn--primary" id="btn-share-native">' + Icons.share + ' Condividi</button>' +
            '<button type="button" class="btn btn--secondary" id="btn-share-download">' + Icons.download + ' Scarica</button>' +
            '<button type="button" class="btn btn--ghost" id="btn-share-copy-text">Copia Testo</button>' +
          '</div>' +
        '</div>';

      overlay.classList.remove('hidden');

      // Bind actions
      var btnNative = document.getElementById('btn-share-native');
      var btnDownload = document.getElementById('btn-share-download');
      var btnCopyText = document.getElementById('btn-share-copy-text');

      if (btnNative) {
        btnNative.addEventListener('click', function () {
          self._shareImageNatively(recipe, dataUrl);
        });
      }

      if (btnDownload) {
        btnDownload.addEventListener('click', function () {
          self._downloadCardImage(recipe.name, dataUrl);
        });
      }

      if (btnCopyText) {
        btnCopyText.addEventListener('click', function () {
          self._copyRecipeText(recipe);
        });
      }
    },

    /**
     * Share the generated image natively using the Web Share API (files parameter)
     */
    async _shareImageNatively(recipe, dataUrl) {
      try {
        var blob = await (await fetch(dataUrl)).blob();
        var file = new File([blob], recipe.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_ricetta.png', { type: blob.type });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: recipe.name,
            text: 'Guarda questa fantastica ricetta di ' + recipe.name + ' su Sapori!'
          });
        } else {
          // Fallback share text with link
          await navigator.share({
            title: recipe.name,
            text: 'Prova la ricetta di "' + recipe.name + '"! Trovi tutto sul mio ricettario Sapori.',
            url: window.location.origin + window.location.pathname
          });
        }
      } catch (e) {
        console.warn('Condivisione nativa non riuscita:', e);
        Utils.showToast('Funzionalità di condivisione non supportata su questo browser', 'info');
      }
    },

    /**
     * Download the card as a local file (fallback for desktops)
     */
    _downloadCardImage(recipeName, dataUrl) {
      var link = document.createElement('a');
      link.download = recipeName.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_cartolina.png';
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      Utils.showToast('Immagine scaricata! 💾', 'success');
    },

    /**
     * Format recipe as clean text card and copy to clipboard
     */
    _copyRecipeText(recipe) {
      var text = '📝 RICETTA: ' + recipe.name.toUpperCase() + '\n';
      if (recipe.description) text += recipe.description + '\n';
      
      text += '\n⏱️ Tempo prep: ' + (recipe.prepTime || '0') + ' min';
      text += '\n🍳 Tempo cottura: ' + (recipe.cookTime || '0') + ' min';
      text += '\n👥 Porzioni: ' + (recipe.servings || '4');
      text += '\n\n🧂 INGREDIENTI:\n';
      recipe.ingredients.forEach(function (ing) {
        text += '• ' + ing.name;
        if (ing.quantity) text += ' (' + ing.quantity + ' ' + (ing.unit || '') + ')';
        text += '\n';
      });

      text += '\n👨‍🍳 PREPARAZIONE:\n';
      recipe.steps.forEach(function (step, idx) {
        text += (idx + 1) + '. ' + step + '\n';
      });

      text += '\nFatto con amore su Sapori App! 📱';

      navigator.clipboard.writeText(text).then(function () {
        Utils.showToast('Testo ricetta copiato negli appunti! 📋', 'success');
      }).catch(function () {
        Utils.showToast('Impossibile copiare il testo', 'error');
      });
    },

    /**
     * Helper to get difficulty labels
     */
    _getDifficultyLabel(diffId) {
      var diffs = { facile: 'Facile', media: 'Media', difficile: 'Difficile' };
      return diffs[diffId] || 'Facile';
    },

    /**
     * Helper to draw wrapped text inside canvas
     */
    _drawTextWrapped(ctx, text, x, y, maxWidth, lineHeight) {
      var words = text.split(' ');
      var line = '';
      var lines = [];

      for (var n = 0; n < words.length; n++) {
        var testLine = line + words[n] + ' ';
        var metrics = ctx.measureText(testLine);
        var testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
          lines.push(line);
          line = words[n] + ' ';
        } else {
          line = testLine;
        }
      }
      lines.push(line);

      for (var i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x, y + (i * lineHeight));
      }
      return lines.length * lineHeight;
    },

    /**
     * Helper to draw filled rounded rect
     */
    _drawRoundedRect(ctx, x, y, width, height, radius, fill) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
    },

    /**
     * Helper path generator for clipping rounded rectangles
     */
    _drawRoundedRectPath(ctx, x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }
  };

  // Expose to window
  window.Share = Share;

})(window);
