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
      Utils.showToast('Generazione cartolina gourmet in corso... 🎨', 'info');
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
        var cardBg = isDark ? '#18181b' : '#ffffff';
        var textColor = isDark ? '#f4f4f5' : '#18181b';
        var textMuted = isDark ? '#a1a1aa' : '#71717a';
        var borderCol = isDark ? '#27272a' : '#f4f4f5';

        // 1. Draw full card background (fills the entire canvas)
        ctx.fillStyle = cardBg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Load and draw recipe image (Hero format: full width, full-bleed at the top)
        var imageX = 0;
        var imageY = 0;
        var imageW = canvas.width;
        var imageH = 430;

        var img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = function () {
          // Draw full-bleed image (no rounded corners needed)
          ctx.save();
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

          // Overlay gradient on bottom of image for text readability
          var overlayGrad = ctx.createLinearGradient(0, imageY + imageH - 120, 0, imageY + imageH);
          overlayGrad.addColorStop(0, 'rgba(0,0,0,0)');
          overlayGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
          ctx.fillStyle = overlayGrad;
          ctx.fillRect(imageX, imageY + imageH - 120, imageW, 120);

          // Draw logo watermark in header area
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText('🍴 SAPORI', canvas.width - 40, 35);

          // Continue drawing texts below image (start at startY = 465)
          self._drawCardDetails(ctx, recipe, 0, 0, canvas.width, canvas.height, imageY + imageH + 35, textColor, textMuted, borderCol, gradColors[0]);
          resolve(canvas.toDataURL('image/png'));
        };

        img.onerror = function () {
          // Fallback if image fails to load or does not exist
          ctx.fillStyle = isDark ? '#27272a' : '#f4f4f5';
          ctx.fillRect(imageX, imageY, imageW, imageH);
          
          ctx.fillStyle = textMuted;
          ctx.font = '64px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('🍽️', imageX + imageW / 2, imageY + imageH / 2 + 10);
          
          ctx.font = 'bold 15px system-ui, sans-serif';
          ctx.fillText('Sapori — Il Tuo Ricettario Personale', imageX + imageW / 2, imageY + imageH / 2 + 60);

          // Continue drawing texts
          self._drawCardDetails(ctx, recipe, 0, 0, canvas.width, canvas.height, imageY + imageH + 35, textColor, textMuted, borderCol, gradColors[0]);
          resolve(canvas.toDataURL('image/png'));
        };

        // Trigger image load (use default placeholder if empty)
        img.src = recipe.image || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        if (img.complete && typeof img.onload === 'function') {
          img.onload();
        }
      });
    },

    /**
     * Draw text details inside the card (full-bleed layout)
     */
    _drawCardDetails(ctx, recipe, cardX, cardY, cardW, cardH, startY, textColor, textMuted, borderCol, themePrimary) {
      var self = this;
      var leftMargin = cardX + 40;
      var contentW = cardW - 80;
      ctx.textAlign = 'left';

      // 1. Category tag (Pill Badge)
      var cat = window.Recipes ? window.Recipes.CATEGORIES.find(c => c.id === recipe.category) : null;
      var catLabel = (cat ? cat.icon + ' ' + cat.label : 'CUCINA').toUpperCase();
      
      // Calculate label width dynamic sizing
      ctx.font = 'bold 11px system-ui, sans-serif';
      var textMetrics = ctx.measureText(catLabel);
      var badgeW = textMetrics.width + 24;
      var badgeH = 24;

      ctx.fillStyle = 'rgba(232, 93, 58, 0.1)';
      self._drawRoundedRect(ctx, leftMargin, startY, badgeW, badgeH, 6, ctx.fillStyle);
      
      ctx.fillStyle = '#E85D3A';
      ctx.textAlign = 'center';
      ctx.fillText(catLabel, leftMargin + (badgeW / 2), startY + 16);

      // 2. Recipe Title
      ctx.textAlign = 'left';
      ctx.fillStyle = textColor;
      ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
      var titleY = startY + 65;
      var titleHeight = self._drawTextWrapped(ctx, recipe.name, leftMargin, titleY, contentW, 42);

      // 3. Metadata Capsules Row
      var capsuleY = titleY + titleHeight + 15;
      var capsuleH = 42;
      var colW = (contentW - 36) / 4; // 12px gap between columns

      var difficultyLabel = self._getDifficultyLabel(recipe.difficulty);
      var metaItems = [
        { val: (recipe.prepTime || '0') + ' min', icon: '⏱️' },
        { val: (recipe.cookTime || '0') + ' min', icon: '🍳' },
        { val: (recipe.servings || '4') + ' porz.', icon: '👥' },
        { val: difficultyLabel, icon: '⭐' }
      ];

      metaItems.forEach(function (item, idx) {
        var x = leftMargin + (idx * (colW + 12));
        
        // Draw soft capsule
        ctx.fillStyle = 'rgba(113, 113, 122, 0.06)';
        self._drawRoundedRect(ctx, x, capsuleY, colW, capsuleH, 10, ctx.fillStyle);
        
        // Label
        ctx.fillStyle = textColor;
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(item.icon + '  ' + item.val, x + (colW / 2), capsuleY + 26);
      });

      // 4. Divider Line
      var dividerY = capsuleY + capsuleH + 28;
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftMargin, dividerY);
      ctx.lineTo(leftMargin + contentW, dividerY);
      ctx.stroke();

      // 5. Ingredients Section
      var ingTitleY = dividerY + 38;
      ctx.textAlign = 'left';
      ctx.fillStyle = textColor;
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText('INGREDIENTI PRINCIPALI', leftMargin, ingTitleY);

      var ingY = ingTitleY + 32;
      ctx.font = '15px system-ui, sans-serif';
      
      if (recipe.ingredients && recipe.ingredients.length > 0) {
        var maxIng = 4;
        var shown = recipe.ingredients.slice(0, maxIng);
        shown.forEach(function (ing, idx) {
          var y = ingY + (idx * 30);
          
          // Draw a small bullet circle matching primary color
          ctx.fillStyle = '#E85D3A';
          ctx.beginPath();
          ctx.arc(leftMargin + 4, y - 5, 4, 0, Math.PI * 2);
          ctx.fill();

          // Ingredient Text
          ctx.fillStyle = textColor;
          ctx.fillText(ing.name, leftMargin + 22, y);

          // Quantity (aligned to the right or styled text)
          if (ing.quantity) {
            ctx.fillStyle = textMuted;
            ctx.textAlign = 'right';
            ctx.fillText(ing.quantity + ' ' + (ing.unit || ''), leftMargin + contentW, y);
            ctx.textAlign = 'left'; // reset
          }
        });

        if (recipe.ingredients.length > maxIng) {
          ctx.fillStyle = textMuted;
          ctx.font = 'italic 14px system-ui, sans-serif';
          ctx.fillText('• ... e altri ' + (recipe.ingredients.length - maxIng) + ' ingredienti', leftMargin, ingY + (maxIng * 30));
        }
      } else {
        ctx.fillStyle = textMuted;
        ctx.fillText('Nessun ingrediente inserito', leftMargin, ingY);
      }

      // 6. Card Footer Watermark
      var footerY = cardH - 40;
      ctx.strokeStyle = borderCol;
      ctx.beginPath();
      ctx.moveTo(leftMargin, footerY - 20);
      ctx.lineTo(leftMargin + contentW, footerY - 20);
      ctx.stroke();

      ctx.fillStyle = textMuted;
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('Creato con amore su Sapori App', leftMargin, footerY);

      ctx.fillStyle = '#E85D3A';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('titangra16.github.io/sapori', leftMargin + contentW, footerY);
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
            '<h3 style="margin:0; font-size:1.15rem; font-weight:700;">Condividi Ricetta</h3>' +
            '<button type="button" class="btn btn--icon" data-action="modal-cancel" style="width:32px; height:32px; display:flex; align-items:center; justify-content:center; border-radius:50%; border:none; background:transparent; cursor:pointer;">' + Icons.x + '</button>' +
          '</div>' +
          '<div class="modal__body" style="text-align:center; padding:10px 0;">' +
            '<p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;">Tieni premuto sull\'immagine per salvarla in galleria, oppure usa le opzioni rapide:</p>' +
            '<div class="share-card-preview-wrapper" style="box-shadow:var(--shadow-lg); border-radius:16px; overflow:hidden; display:inline-block; border:1px solid var(--border); max-width:100%; transition: transform 0.2s ease;">' +
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
     * Helper to draw filled rounded rect with different corner radii
     */
    _drawRoundedRectComplex(ctx, x, y, width, height, topLeft, topRight, bottomLeft, bottomRight, fill) {
      ctx.beginPath();
      ctx.moveTo(x + topLeft, y);
      ctx.lineTo(x + width - topRight, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + topRight);
      ctx.lineTo(x + width, y + height - bottomRight);
      ctx.quadraticCurveTo(x + width, y + height, x + width - bottomRight, y + height);
      ctx.lineTo(x + bottomLeft, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - bottomLeft);
      ctx.lineTo(x, y + topLeft);
      ctx.quadraticCurveTo(x, y, x + topLeft, y);
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
    },

    /**
     * Complex path generator for clipping rounded rectangles with specific corner radii
     */
    _drawRoundedRectPathComplex(ctx, x, y, width, height, topLeft, topRight, bottomLeft, bottomRight) {
      ctx.beginPath();
      ctx.moveTo(x + topLeft, y);
      ctx.lineTo(x + width - topRight, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + topRight);
      ctx.lineTo(x + width, y + height - bottomRight);
      ctx.quadraticCurveTo(x + width, y + height, x + width - bottomRight, y + height);
      ctx.lineTo(x + bottomLeft, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - bottomLeft);
      ctx.lineTo(x, y + topLeft);
      ctx.quadraticCurveTo(x, y, x + topLeft, y);
      ctx.closePath();
    }
  };

  // Expose to window
  window.Share = Share;

})(window);
