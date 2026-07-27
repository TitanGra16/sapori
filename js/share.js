(function (window) {
  'use strict';

  var Share = {

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
        // Work in logical pixels and render at 1080 × 1350 (the common 4:5
        // social-card ratio) for crisp text on high-density displays.
        var W = 900, H = 1125, scale = 1.2;
        var canvas = document.createElement('canvas');
        canvas.width = W * scale;
        canvas.height = H * scale;
        var ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas non disponibile'));
          return;
        }
        ctx.scale(scale, scale);

        // Theme
        var activeTheme = window.Theme ? window.Theme.getCurrentTheme() : { mode: 'dark', palette: 'classico' };
        var palette = activeTheme.palette || 'classico';
        var isDark = activeTheme.mode === 'dark';
        var paletteList = window.Theme ? window.Theme.PALETTES : [];
        var paletteInfo = paletteList.find(function (item) { return item.id === palette; }) ||
          paletteList.find(function (item) { return item.id === 'classico'; });
        var gc = paletteInfo && paletteInfo.colors ? paletteInfo.colors : ['#E85D3A', '#FFA726'];

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
          ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
          self._drawRoundedRect(ctx, W - 164, 17, 128, 34, 17, 'rgba(0,0,0,0.58)');
          ctx.fillStyle = '#ffffff';
          ctx.fillText('🍴 SAPORI', W - 36, 40);

          // Category pill on band
          var cat = window.Recipes ? window.Recipes.CATEGORIES.find(c => c.id === recipe.category) : null;
          var catLabel = (cat ? cat.icon + ' ' + cat.label : '🍽 Cucina').toUpperCase();
          ctx.font = 'bold 13px system-ui, sans-serif';
          var catW = ctx.measureText(catLabel).width + 28;
          self._drawRoundedRect(ctx, 36, bandH - 140, catW, 28, 14, 'rgba(0,0,0,0.58)');
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.fillText(catLabel, 36 + 14, bandH - 121);

          // Recipe title on band
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 44px system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'left';
          self._drawTextWrapped(ctx, recipe.name, 36, bandH - 86, W - 72, 52, 2);

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
              ctx.fillText(self._truncateText(ctx, ing.name, cW - 170), sX + 22, iy);
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
      var hasNativeShare = typeof navigator.share === 'function';

      overlay.innerHTML =
        '<div class="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-modal-title" aria-describedby="share-modal-description">' +
          '<div class="share-modal__accent"></div>' +
          '<div class="share-modal__header">' +
            '<div class="share-modal__header-left">' +
              '<span class="share-modal__label">Condividi ricetta</span>' +
              '<h2 class="share-modal__title" id="share-modal-title">' + esc(recipe.name) + '</h2>' +
            '</div>' +
            '<button type="button" class="btn btn--icon share-modal__close" data-action="modal-cancel" aria-label="Chiudi condivisione">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
                '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
              '</svg>' +
            '</button>' +
          '</div>' +
          '<div class="share-modal__body">' +
            '<p class="share-modal__description" id="share-modal-description">Scegli il formato più adatto: immagine da pubblicare, testo completo o file da importare in Sapori.</p>' +
            '<div class="share-modal__layout">' +
              '<section class="share-modal__visual" aria-label="Anteprima cartolina">' +
                '<button type="button" class="share-modal__preview-wrap" id="btn-share-preview" aria-label="Scarica la cartolina di ' + esc(recipe.name) + '">' +
                  '<img class="share-modal__preview-img" src="' + dataUrl + '" alt="Anteprima della cartolina ' + esc(recipe.name) + '">' +
                  '<span class="share-modal__preview-overlay">Scarica PNG</span>' +
                '</button>' +
                '<p class="share-modal__preview-hint">Formato verticale 1080 × 1350, pronto per chat e social.</p>' +
              '</section>' +
              '<section class="share-modal__options" aria-label="Opzioni di condivisione">' +
                (hasNativeShare
                  ? '<button type="button" class="share-modal__native-btn" id="btn-share-native">' +
                      '<span class="share-modal__native-icon">📤</span>' +
                      '<span><strong>Condividi ora</strong><small>Usa le app disponibili sul dispositivo</small></span>' +
                    '</button>'
                  : '') +
                '<h3 class="share-modal__group-title">Salva o copia</h3>' +
                '<div class="share-modal__actions">' +
                  '<button type="button" class="share-modal__action-btn" id="btn-share-download">' +
                    '<span class="share-modal__action-icon">🖼️</span>' +
                    '<span class="share-modal__action-copy"><strong>Cartolina PNG</strong><small>Immagine pronta da inviare</small></span>' +
                  '</button>' +
                  '<button type="button" class="share-modal__action-btn' + (!hasNativeShare ? ' share-modal__action-btn--primary' : '') + '" id="btn-share-copy-text">' +
                    '<span class="share-modal__action-icon">📋</span>' +
                    '<span class="share-modal__action-copy"><strong>Testo completo</strong><small>Ingredienti e preparazione</small></span>' +
                  '</button>' +
                  '<button type="button" class="share-modal__action-btn" id="btn-share-download-file">' +
                    '<span class="share-modal__action-icon">📦</span>' +
                    '<span class="share-modal__action-copy"><strong>File ricetta</strong><small>Importabile su un altro Sapori</small></span>' +
                  '</button>' +
                '</div>' +
                '<h3 class="share-modal__group-title">Invia con</h3>' +
                '<div class="share-modal__social-actions">' +
                  '<button type="button" class="share-modal__social-btn share-modal__social-btn--whatsapp" id="btn-share-whatsapp"><span aria-hidden="true">💬</span> WhatsApp</button>' +
                  '<button type="button" class="share-modal__social-btn share-modal__social-btn--telegram" id="btn-share-telegram"><span aria-hidden="true">✈️</span> Telegram</button>' +
                '</div>' +
                '<p class="share-modal__portable-note"><span aria-hidden="true">🔒</span><span>Il file ricetta contiene tutti i dati della ricetta. Le tue altre ricette restano private sul dispositivo.</span></p>' +
              '</section>' +
            '</div>' +
            '<div class="share-modal__link-section">' +
              '<div class="share-modal__link-copy-wrap">' +
                '<span class="share-modal__link-label">Link dell’app</span>' +
                '<span class="share-modal__link-url" title="' + esc(pwaUrl) + '">' + esc(pwaUrl) + '</span>' +
              '</div>' +
              '<button type="button" class="share-modal__link-copy" id="btn-share-copy-link">Copia</button>' +
              '<p>Questo link apre Sapori, ma non contiene la ricetta.</p>' +
            '</div>' +
          '</div>' +
        '</div>';

      overlay.classList.remove('hidden');

      var btnNative   = document.getElementById('btn-share-native');
      var btnPreview  = document.getElementById('btn-share-preview');
      var btnDownload = document.getElementById('btn-share-download');
      var btnCopyText = document.getElementById('btn-share-copy-text');
      var btnFile     = document.getElementById('btn-share-download-file');
      var btnWA       = document.getElementById('btn-share-whatsapp');
      var btnTG       = document.getElementById('btn-share-telegram');
      var btnCopyLink = document.getElementById('btn-share-copy-link');

      if (btnNative) {
        btnNative.addEventListener('click', async function () {
          if (btnNative.disabled) return;
          btnNative.disabled = true;
          try {
            await self._shareImageNatively(recipe, dataUrl);
          } finally {
            btnNative.disabled = false;
          }
        });
      }

      var downloadCard = function () { self._downloadCardImage(recipe.name, dataUrl); };
      if (btnPreview) btnPreview.addEventListener('click', downloadCard);
      if (btnDownload) btnDownload.addEventListener('click', downloadCard);

      if (btnCopyText) {
        btnCopyText.addEventListener('click', function () {
          self._copyRecipeText(recipe);
        });
      }

      if (btnFile) {
        btnFile.addEventListener('click', function () {
          self._downloadRecipeFile(recipe);
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
            btnCopyLink.classList.add('is-copied');
            setTimeout(function () {
              btnCopyLink.textContent = 'Copia';
              btnCopyLink.classList.remove('is-copied');
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
        var fname = this._filenameBase(recipe.name);
        var imageFile = new File([blob], fname + '_ricetta.png', { type: blob.type });
        var recipeFile = new File(
          [JSON.stringify(Recipes.formatRecipeForExport(recipe), null, 2)],
          fname + '_ricetta.json',
          { type: 'application/json' }
        );
        await navigator.share(this._buildNativeSharePayload(
          recipe,
          imageFile,
          recipeFile,
          fullText
        ));
      } catch (e) {
        if (e.name !== 'AbortError') {
          Utils.showToast('Condivisione non supportata su questo browser', 'info');
        }
      }
    },

    _buildNativeSharePayload(recipe, imageFile, recipeFile, fullText) {
      var canShareFiles = function (files) {
        if (typeof navigator.canShare !== 'function') return false;
        try {
          return navigator.canShare({ files: files });
        } catch (error) {
          return false;
        }
      };

      if (canShareFiles([imageFile, recipeFile])) {
        return {
          files: [imageFile, recipeFile],
          title: recipe.name,
          text: 'Cartolina e file importabile della ricetta “' + recipe.name + '”.'
        };
      }
      if (canShareFiles([imageFile])) {
        return {
          files: [imageFile],
          title: recipe.name,
          text: 'Cartolina della ricetta “' + recipe.name + '”.'
        };
      }
      if (canShareFiles([recipeFile])) {
        return {
          files: [recipeFile],
          title: recipe.name,
          text: 'File importabile della ricetta “' + recipe.name + '”.'
        };
      }
      return {
        title: recipe.name,
        text: fullText
      };
    },

    _downloadCardImage(recipeName, dataUrl) {
      var link = document.createElement('a');
      link.download = this._filenameBase(recipeName) + '_cartolina.png';
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      Utils.showToast('Cartolina PNG scaricata', 'success');
    },

    _downloadRecipeFile(recipe) {
      var json = JSON.stringify(Recipes.formatRecipeForExport(recipe), null, 2);
      Utils.triggerDownload(
        json,
        this._filenameBase(recipe.name) + '_ricetta_sapori.json',
        'application/json'
      );
      Utils.showToast('File ricetta scaricato: potrai importarlo in Sapori', 'success');
    },

    _copyRecipeText(recipe) {
      this._copyText(this._buildShareText(recipe)).then(function () {
        Utils.showToast('Ricetta completa copiata', 'success');
      }).catch(function () {
        Utils.showToast('Impossibile copiare il testo', 'error');
      });
    },

    _shareViaWhatsApp(recipe) {
      var text = this._buildShareText(recipe);
      var url = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(text);
      this._openExternalShare(url);
    },

    _shareViaTelegram(recipe) {
      var text = this._buildShareText(recipe);
      var url = 'https://t.me/share/url?url=' +
        encodeURIComponent(window.location.origin + window.location.pathname) +
        '&text=' + encodeURIComponent(text);
      this._openExternalShare(url);
    },

    _openExternalShare(url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    },

    _filenameBase(recipeName) {
      var normalized = String(recipeName || 'ricetta');
      if (typeof normalized.normalize === 'function') {
        normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      }
      normalized = normalized
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      return normalized || 'ricetta';
    },

    _buildShareText(recipe) {
      var diffMap = { facile: 'Facile', media: 'Media', difficile: 'Difficile' };
      var lines = ['🍴 *' + String(recipe.name || '').toUpperCase() + '*'];
      if (recipe.description) lines.push('_' + recipe.description + '_');
      lines.push('');
      lines.push('⏱ Preparazione: ' + (recipe.prepTime || 0) + ' min');
      lines.push('🍳 Cottura: ' + (recipe.cookTime || 0) + ' min');
      lines.push('⌛ Tempo totale: ' + ((parseInt(recipe.prepTime, 10) || 0) + (parseInt(recipe.cookTime, 10) || 0)) + ' min');
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
      if (recipe.storage) {
        lines.push('');
        lines.push('🧊 Conservazione: ' + recipe.storage);
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

    /* ────────────────────────────────────────────────────────
       Canvas Helpers
    ──────────────────────────────────────────────────────── */
    _drawTextWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
      if (!text) return 0;
      var words = String(text).trim().split(/\s+/);
      var line = '';
      var lines = [];
      var pushLongWord = function (word) {
        var chunk = '';
        Array.from(word).forEach(function (character) {
          if (chunk && ctx.measureText(chunk + character).width > maxWidth) {
            lines.push(chunk);
            chunk = character;
          } else {
            chunk += character;
          }
        });
        return chunk;
      };

      for (var n = 0; n < words.length; n++) {
        var word = words[n];
        var test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width <= maxWidth) {
          line = test;
        } else if (line) {
          lines.push(line);
          line = ctx.measureText(word).width > maxWidth ? pushLongWord(word) : word;
        } else {
          line = pushLongWord(word);
        }
      }
      if (line) lines.push(line);
      if (maxLines && lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        var lastLine = lines[maxLines - 1] || '';
        while (lastLine && ctx.measureText(lastLine + '…').width > maxWidth) {
          lastLine = lastLine.slice(0, -1);
        }
        lines[maxLines - 1] = lastLine.replace(/[\s,.;:!?-]+$/g, '') + '…';
      }
      lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lineHeight); });
      return lines.length * lineHeight;
    },

    _truncateText(ctx, text, maxWidth) {
      var value = String(text || '');
      if (ctx.measureText(value).width <= maxWidth) return value;
      while (value && ctx.measureText(value + '…').width > maxWidth) {
        value = value.slice(0, -1);
      }
      return value.replace(/[\s,.;:!?-]+$/g, '') + '…';
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
