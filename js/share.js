(function (window) {
  'use strict';

  var Share = {

    // Gradient definitions per palette
    _gradients: {
      classico:  ['#E85D3A', '#FFA726'],
      oceano:    ['#0EA5E9', '#06B6D4'],
      bosco:     ['#16A34A', '#84CC16'],
      tramonto:  ['#DB2777', '#EC4899'],
      ametista:  ['#8B5CF6', '#A78BFA'],
      autunno:   ['#8C5A3C', '#F5BE94'],
      zafferano: ['#D97706', '#FBBF24']
    },

    /* ────────────────────────────────────────────────────────
       PUBLIC: Open share menu
    ──────────────────────────────────────────────────────── */
    async openShareMenu(recipe) {
      Utils.showToast('Generazione cartolina in corso… 🎨', 'info');
      try {
        var dataUrl = await this.generateCardDataURL(recipe);
        this._showShareModal(recipe, dataUrl);
      } catch (e) {
        console.error('Errore generazione cartolina:', e);
        Utils.showToast('Impossibile generare la cartolina', 'error');
      }
    },

    /* ────────────────────────────────────────────────────────
       CANVAS — Generate share card
    ──────────────────────────────────────────────────────── */
    generateCardDataURL(recipe) {
      var self = this;
      return new Promise(function (resolve, reject) {
        var W = 900, H = 1100;
        var canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        var ctx = canvas.getContext('2d');

        // Theme
        var activeTheme = window.Theme ? window.Theme.getCurrentTheme() : { mode: 'dark', palette: 'classico' };
        var palette = activeTheme.palette || 'classico';
        var isDark = activeTheme.mode === 'dark';
        var gc = self._gradients[palette] || self._gradients.classico;

        // Colors
        var bgCard  = isDark ? '#18181b' : '#ffffff';
        var bgSurf  = isDark ? '#27272a' : '#f9f6f3';
        var textCol = isDark ? '#f4f4f5' : '#1a0f0a';
        var mutedCol= isDark ? '#a1a1aa' : '#71717a';
        var borderC = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

        // 1. Background
        ctx.fillStyle = bgCard;
        ctx.fillRect(0, 0, W, H);

        // 2. Top gradient band
        var bandH = 400;
        var grad = ctx.createLinearGradient(0, 0, W, bandH);
        grad.addColorStop(0, gc[0]);
        grad.addColorStop(1, gc[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, bandH);

        // 3. Load image
        var img = new Image();
        img.crossOrigin = 'anonymous';

        var drawContent = function (hasImage) {
          if (hasImage) {
            // Clip image into top band
            ctx.save();
            ctx.globalAlpha = 0.35;
            var ir = img.width / img.height;
            var bR = W / bandH;
            var dW, dH, dX, dY;
            if (ir > bR) { dH = bandH; dW = dH * ir; dX = -(dW - W) / 2; dY = 0; }
            else { dW = W; dH = dW / ir; dX = 0; dY = -(dH - bandH) / 2; }
            ctx.drawImage(img, dX, dY, dW, dH);
            ctx.restore();
          }

          // Gradient overlay on band bottom for readability
          var ovGrad = ctx.createLinearGradient(0, bandH - 160, 0, bandH);
          ovGrad.addColorStop(0, 'rgba(0,0,0,0)');
          ovGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
          ctx.fillStyle = ovGrad;
          ctx.fillRect(0, bandH - 160, W, 160);

          // Watermark on band
          ctx.textAlign = 'right';
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
          ctx.fillText('🍴 SAPORI', W - 36, 40);

          // Category pill on band
          var cat = window.Recipes ? window.Recipes.CATEGORIES.find(c => c.id === recipe.category) : null;
          var catLabel = (cat ? cat.icon + ' ' + cat.label : '🍽 Cucina').toUpperCase();
          ctx.font = 'bold 13px system-ui, sans-serif';
          var catW = ctx.measureText(catLabel).width + 28;
          self._drawRoundedRect(ctx, 36, bandH - 140, catW, 28, 14, 'rgba(255,255,255,0.22)');
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.fillText(catLabel, 36 + 14, bandH - 121);

          // Recipe title on band
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 44px system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'left';
          self._drawTextWrapped(ctx, recipe.name, 36, bandH - 86, W - 72, 52);

          // ── Content area below band ──
          var sX = 36, cW = W - 72, y = bandH + 36;

          // Info capsules
          var diffLabel = { facile: 'Facile', media: 'Media', difficile: 'Difficile' }[recipe.difficulty] || 'Facile';
          var metaItems = [
            { icon: '⏱', label: 'Prep', val: (recipe.prepTime || 0) + ' min' },
            { icon: '🍳', label: 'Cottura', val: (recipe.cookTime || 0) + ' min' },
            { icon: '👥', label: 'Porzioni', val: String(recipe.servings || 4) },
            { icon: '⭐', label: 'Difficoltà', val: diffLabel }
          ];
          var capW = (cW - 30) / 4, capH = 56;
          metaItems.forEach(function (m, i) {
            var cx = sX + i * (capW + 10);
            self._drawRoundedRect(ctx, cx, y, capW, capH, 12, bgSurf);
            ctx.strokeStyle = borderC;
            ctx.lineWidth = 1;
            self._drawRoundedRectPath(ctx, cx, y, capW, capH, 12);
            ctx.stroke();
            // icon
            ctx.font = '17px system-ui';
            ctx.textAlign = 'center';
            ctx.fillStyle = gc[0];
            ctx.fillText(m.icon, cx + capW / 2, y + 21);
            // value
            ctx.font = 'bold 13px system-ui, sans-serif';
            ctx.fillStyle = textCol;
            ctx.fillText(m.val, cx + capW / 2, y + 39);
          });
          y += capH + 32;

          // Description (up to 2 lines)
          if (recipe.description) {
            ctx.font = 'italic 15px system-ui, sans-serif';
            ctx.fillStyle = mutedCol;
            ctx.textAlign = 'left';
            var descH = self._drawTextWrapped(ctx, recipe.description, sX, y, cW, 22, 2);
            y += descH + 24;
          }

          // Divider
          ctx.strokeStyle = borderC;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(sX, y); ctx.lineTo(sX + cW, y); ctx.stroke();
          y += 26;

          // Ingredients section title
          ctx.font = 'bold 13px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillStyle = gc[0];
          ctx.fillText('INGREDIENTI', sX, y);
          y += 24;

          // Ingredients list
          if (recipe.ingredients && recipe.ingredients.length > 0) {
            var maxI = Math.min(recipe.ingredients.length, 6);
            recipe.ingredients.slice(0, maxI).forEach(function (ing, idx) {
              var iy = y + idx * 30;
              // Bullet
              ctx.beginPath();
              ctx.arc(sX + 6, iy - 5, 5, 0, Math.PI * 2);
              ctx.fillStyle = gc[0];
              ctx.fill();
              // Name
              ctx.font = '15px system-ui, sans-serif';
              ctx.fillStyle = textCol;
              ctx.textAlign = 'left';
              ctx.fillText(ing.name, sX + 22, iy);
              // Quantity
              if (ing.quantity) {
                ctx.fillStyle = mutedCol;
                ctx.textAlign = 'right';
                ctx.fillText(ing.quantity + (ing.unit ? ' ' + ing.unit : ''), sX + cW, iy);
              }
            });
            y += maxI * 30;
            if (recipe.ingredients.length > maxI) {
              ctx.fillStyle = mutedCol;
              ctx.font = 'italic 13px system-ui, sans-serif';
              ctx.textAlign = 'left';
              ctx.fillText('… e altri ' + (recipe.ingredients.length - maxI) + ' ingredienti', sX, y);
              y += 22;
            }
          }

          y += 12;

          // Divider
          ctx.strokeStyle = borderC;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(sX, y); ctx.lineTo(sX + cW, y); ctx.stroke();
          y += 22;

          // Steps preview (first 2)
          if (recipe.steps && recipe.steps.length > 0) {
            ctx.font = 'bold 13px system-ui, sans-serif';
            ctx.fillStyle = gc[0];
            ctx.textAlign = 'left';
            ctx.fillText('PREPARAZIONE', sX, y);
            y += 24;

            var previewSteps = recipe.steps.slice(0, 2);
            previewSteps.forEach(function (s, i) {
              var text = typeof s === 'object' ? s.text : s;
              // Step number circle
              ctx.beginPath();
              ctx.arc(sX + 12, y - 4, 12, 0, Math.PI * 2);
              ctx.fillStyle = gc[0];
              ctx.fill();
              ctx.font = 'bold 11px system-ui, sans-serif';
              ctx.fillStyle = '#ffffff';
              ctx.textAlign = 'center';
              ctx.fillText(String(i + 1), sX + 12, y + 1);
              // Step text
              ctx.font = '14px system-ui, sans-serif';
              ctx.fillStyle = textCol;
              ctx.textAlign = 'left';
              var truncated = text.length > 72 ? text.slice(0, 69) + '…' : text;
              ctx.fillText(truncated, sX + 32, y);
              y += 32;
            });

            if (recipe.steps.length > 2) {
              ctx.font = 'italic 13px system-ui, sans-serif';
              ctx.fillStyle = mutedCol;
              ctx.textAlign = 'left';
              ctx.fillText('… e altri ' + (recipe.steps.length - 2) + ' passaggi', sX, y);
              y += 22;
            }
          }

          // Footer
          var footerY = H - 40;
          ctx.strokeStyle = borderC;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(sX, footerY - 18); ctx.lineTo(sX + cW, footerY - 18); ctx.stroke();
          ctx.font = '12px system-ui, sans-serif';
          ctx.fillStyle = mutedCol;
          ctx.textAlign = 'left';
          ctx.fillText('Creato con ❤️ su Sapori App', sX, footerY);
          ctx.fillStyle = gc[0];
          ctx.font = 'bold 12px system-ui, sans-serif';
          ctx.textAlign = 'right';
          var appLocation = window.location.host + window.location.pathname.replace(/\/index\.html$/, '');
          ctx.fillText(appLocation, sX + cW, footerY);

          resolve(canvas.toDataURL('image/png'));
        };

        img.onload = function () { drawContent(true); };
        img.onerror = function () { drawContent(false); };

        if (recipe.image && recipe.image.length > 10) {
          img.src = recipe.image;
        } else {
          drawContent(false);
        }
      });
    },

    /* ────────────────────────────────────────────────────────
       MODAL — Premium Share UI
    ──────────────────────────────────────────────────────── */
    _showShareModal(recipe, dataUrl) {
      var self = this;
      var overlay = document.getElementById('modal-overlay');
      if (!overlay) return;
      var esc = Utils.escapeHtml;
      var pwaUrl = window.location.origin + window.location.pathname;
      var hasNativeShare = !!(navigator.share);

      overlay.innerHTML =
        '<div class="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">' +
          // Accent band
          '<div class="share-modal__accent"></div>' +

          // Header
          '<div class="share-modal__header">' +
            '<div class="share-modal__header-left">' +
              '<span class="share-modal__label">📲 Condividi Ricetta</span>' +
              '<h2 class="share-modal__title" id="share-modal-title">' + esc(recipe.name) + '</h2>' +
            '</div>' +
            '<button type="button" class="btn btn--icon" data-action="modal-cancel" aria-label="Chiudi condivisione" ' +
              'style="border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
                '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
              '</svg>' +
            '</button>' +
          '</div>' +

          // Body
          '<div class="share-modal__body">' +

            // Card preview
            '<div class="share-modal__preview-wrap">' +
              '<img class="share-modal__preview-img" src="' + dataUrl + '" alt="Cartolina ' + esc(recipe.name) + '">' +
            '</div>' +
            '<p class="share-modal__preview-hint">Tieni premuto sull\'immagine per salvarla in galleria</p>' +

            // Actions grid (4 buttons)
            '<div class="share-modal__actions">' +

              (hasNativeShare
                ? '<button class="share-modal__action-btn share-modal__action-btn--primary" id="btn-share-native">' +
                    '<span class="share-modal__action-icon">📤</span>' +
                    '<span class="share-modal__action-label">Condividi</span>' +
                  '</button>'
                : '') +

              '<button class="share-modal__action-btn" id="btn-share-download">' +
                '<span class="share-modal__action-icon">💾</span>' +
                '<span class="share-modal__action-label">Scarica Immagine</span>' +
              '</button>' +

              '<button class="share-modal__action-btn" id="btn-share-copy-text">' +
                '<span class="share-modal__action-icon">📋</span>' +
                '<span class="share-modal__action-label">Copia Testo</span>' +
              '</button>' +

              // Divider
              '<div class="share-modal__divider"></div>' +

              '<button class="share-modal__action-btn share-modal__action-btn--whatsapp" id="btn-share-whatsapp">' +
                '<span class="share-modal__action-icon">💬</span>' +
                '<span class="share-modal__action-label">WhatsApp</span>' +
              '</button>' +

              '<button class="share-modal__action-btn share-modal__action-btn--telegram" id="btn-share-telegram">' +
                '<span class="share-modal__action-icon">✈️</span>' +
                '<span class="share-modal__action-label">Telegram</span>' +
              '</button>' +

            '</div>' +

            // Link section
            '<div class="share-modal__link-section">' +
              '<span class="share-modal__link-url" title="Le ricette restano locali: questo link apre soltanto Sapori">' + esc(pwaUrl) + '</span>' +
              '<button class="share-modal__link-copy" id="btn-share-copy-link">Copia link app</button>' +
            '</div>' +

          '</div>' + // body
        '</div>';

      overlay.classList.remove('hidden');

      // ── Bind actions ──
      var btnNative   = document.getElementById('btn-share-native');
      var btnDownload = document.getElementById('btn-share-download');
      var btnCopyText = document.getElementById('btn-share-copy-text');
      var btnWA       = document.getElementById('btn-share-whatsapp');
      var btnTG       = document.getElementById('btn-share-telegram');
      var btnCopyLink = document.getElementById('btn-share-copy-link');

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

      if (btnWA) {
        btnWA.addEventListener('click', function () {
          self._shareViaWhatsApp(recipe);
        });
      }

      if (btnTG) {
        btnTG.addEventListener('click', function () {
          self._shareViaTelegram(recipe);
        });
      }

      if (btnCopyLink) {
        btnCopyLink.addEventListener('click', function () {
          var url = window.location.origin + window.location.pathname;
          self._copyText(url).then(function () {
            btnCopyLink.textContent = 'Copiato ✓';
            btnCopyLink.style.background = 'var(--primary)';
            btnCopyLink.style.color = '#fff';
            setTimeout(function () {
              btnCopyLink.textContent = 'Copia link app';
              btnCopyLink.style.background = '';
              btnCopyLink.style.color = '';
            }, 2000);
            Utils.showToast('Link dell’app copiato. Le ricette restano sul dispositivo.', 'success');
          }).catch(function () {
            Utils.showToast('Impossibile copiare il link', 'error');
          });
        });
      }
    },

    /* ────────────────────────────────────────────────────────
       Share helpers
    ──────────────────────────────────────────────────────── */
    async _shareImageNatively(recipe, dataUrl) {
      try {
        var fullText = this._buildShareText(recipe);
        var blob = await (await fetch(dataUrl)).blob();
        var fname = recipe.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        var imageFile = new File([blob], fname + '_ricetta.png', { type: blob.type });
        var recipeFile = new File(
          [JSON.stringify(Recipes.formatRecipeForExport(recipe), null, 2)],
          fname + '_ricetta.json',
          { type: 'application/json' }
        );

        if (navigator.canShare && navigator.canShare({ files: [imageFile, recipeFile] })) {
          await navigator.share({
            files: [imageFile, recipeFile],
            title: recipe.name,
            text: 'Cartolina e file importabile della ricetta “' + recipe.name + '”.'
          });
        } else if (navigator.canShare && navigator.canShare({ files: [recipeFile] })) {
          await navigator.share({
            files: [recipeFile],
            title: recipe.name,
            text: 'File importabile della ricetta “' + recipe.name + '”.'
          });
        } else {
          await navigator.share({
            title: recipe.name,
            text: fullText,
            url: window.location.origin + window.location.pathname
          });
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          Utils.showToast('Condivisione non supportata su questo browser', 'info');
        }
      }
    },

    _downloadCardImage(recipeName, dataUrl) {
      var link = document.createElement('a');
      link.download = recipeName.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_cartolina.png';
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      Utils.showToast('Immagine scaricata! 💾', 'success');
    },

    _copyRecipeText(recipe) {
      this._copyText(this._buildShareText(recipe)).then(function () {
        Utils.showToast('Testo copiato! Incollalo su WhatsApp o Telegram 📋', 'success');
      }).catch(function () {
        Utils.showToast('Impossibile copiare il testo', 'error');
      });
    },

    _shareViaWhatsApp(recipe) {
      var text = this._buildShareText(recipe);
      var url = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(text);
      window.open(url, '_blank', 'noopener,noreferrer');
    },

    _shareViaTelegram(recipe) {
      var text = this._buildShareText(recipe);
      var url = 'https://t.me/share/url?url=' +
        encodeURIComponent(window.location.origin + window.location.pathname) +
        '&text=' + encodeURIComponent(text);
      window.open(url, '_blank', 'noopener,noreferrer');
    },

    _buildShareText(recipe) {
      var diffMap = { facile: 'Facile', media: 'Media', difficile: 'Difficile' };
      var lines = ['🍴 *' + String(recipe.name || '').toUpperCase() + '*'];
      if (recipe.description) lines.push('_' + recipe.description + '_');
      lines.push('');
      lines.push('⏱ Preparazione: ' + (recipe.prepTime || 0) + ' min');
      lines.push('🍳 Cottura: ' + (recipe.cookTime || 0) + ' min');
      lines.push('👥 Porzioni: ' + (recipe.servings || 4));
      lines.push('⭐ Difficoltà: ' + (diffMap[recipe.difficulty] || 'Media'));
      lines.push('');

      lines.push('🧂 *INGREDIENTI:*');
      (recipe.ingredients || []).forEach(function (ing) {
        var qty = ing.quantity ? ing.quantity + (ing.unit ? ' ' + ing.unit : '') + ' ' : '';
        var notes = ing.notes ? ' (' + ing.notes + ')' : '';
        lines.push('• ' + qty + String(ing.name || '') + notes);
      });
      lines.push('');

      lines.push('👨‍🍳 *PREPARAZIONE:*');
      (recipe.steps || []).forEach(function (step, index) {
        var text = typeof step === 'object' ? step.text : step;
        var notes = typeof step === 'object' && step.notes ? ' (💡 ' + step.notes + ')' : '';
        lines.push((index + 1) + '. ' + String(text || '') + notes);
      });
      if (recipe.notes) {
        lines.push('');
        lines.push('📝 Note: ' + recipe.notes);
      }
      lines.push('');
      lines.push('—');
      lines.push('Creata con Sapori. Le ricette dell’app restano salvate localmente sul dispositivo.');
      lines.push(window.location.origin + window.location.pathname);
      return lines.join('\n');
    },

    _copyText(text) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text);
      }

      return new Promise(function (resolve, reject) {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
          if (document.execCommand('copy')) resolve();
          else reject(new Error('Copy command unavailable'));
        } catch (err) {
          reject(err);
        } finally {
          document.body.removeChild(textarea);
        }
      });
    },

    _getDifficultyLabel(diffId) {
      return { facile: 'Facile', media: 'Media', difficile: 'Difficile' }[diffId] || 'Facile';
    },

    /* ────────────────────────────────────────────────────────
       Canvas Helpers
    ──────────────────────────────────────────────────────── */
    _drawTextWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
      if (!text) return 0;
      var words = String(text).split(' ');
      var line = '', lines = [];
      for (var n = 0; n < words.length; n++) {
        var test = line + words[n] + ' ';
        if (ctx.measureText(test).width > maxWidth && n > 0) {
          lines.push(line.trim());
          line = words[n] + ' ';
        } else {
          line = test;
        }
      }
      if (line.trim()) lines.push(line.trim());
      if (maxLines && lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        if (lines[maxLines - 1]) lines[maxLines - 1] = lines[maxLines - 1].slice(0, -3) + '…';
      }
      lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lineHeight); });
      return lines.length * lineHeight;
    },

    _drawRoundedRect(ctx, x, y, w, h, r, fill) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    },

    _drawRoundedRectPath(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
  };

  window.Share = Share;

})(window);
