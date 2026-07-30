/**
 * Piccolo dialogo accessibile usato durante la costruzione del ricettario.
 */
(function (global) {
  'use strict';

  function open(options) {
    options = options || {};
    var documentRef = options.document || global.document;
    if (!documentRef || !documentRef.body) {
      throw new Error('Documento non disponibile');
    }

    var previousFocus = documentRef.activeElement;
    var overlay = documentRef.createElement('div');
    overlay.className = 'print-progress-overlay';
    overlay.innerHTML =
      '<div class="print-progress-dialog" role="dialog" aria-modal="true" ' +
        'aria-labelledby="print-progress-title" aria-describedby="print-progress-status">' +
        '<div class="print-progress-dialog__icon" aria-hidden="true">📚</div>' +
        '<h2 id="print-progress-title">Preparo il ricettario</h2>' +
        '<p id="print-progress-status" role="status" aria-live="polite">Avvio della preparazione…</p>' +
        '<progress class="print-progress-dialog__bar" max="100" value="0">0%</progress>' +
        '<button type="button" class="btn btn--ghost" data-print-progress-cancel>Annulla</button>' +
      '</div>';

    var status = overlay.querySelector('#print-progress-status');
    var progress = overlay.querySelector('.print-progress-dialog__bar');
    var cancelButton = overlay.querySelector('[data-print-progress-cancel]');
    var closed = false;

    function requestCancel() {
      if (cancelButton.disabled) return;
      cancelButton.disabled = true;
      cancelButton.textContent = 'Annullamento…';
      status.textContent = 'Interrompo la preparazione in modo sicuro…';
      if (typeof options.onCancel === 'function') options.onCancel();
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestCancel();
      }
    }

    cancelButton.addEventListener('click', requestCancel);
    documentRef.addEventListener('keydown', onKeydown);
    documentRef.body.appendChild(overlay);
    global.requestAnimationFrame(function () {
      if (!closed && cancelButton.isConnected) cancelButton.focus();
    });

    return {
      update: function (value) {
        if (closed || !value) return;
        var completed = Math.max(0, Number(value.completed) || 0);
        var total = Math.max(0, Number(value.total) || 0);
        var percent = total > 0
          ? Math.min(100, Math.round((completed / total) * 100))
          : 0;
        progress.value = percent;
        progress.textContent = percent + '%';
        if (value.phase === 'index') {
          status.textContent = 'Creo l’indice: ' + completed + ' di ' + total;
        } else if (value.phase === 'recipes') {
          status.textContent = 'Impagino le ricette: ' + completed + ' di ' + total;
        } else if (value.phase === 'images') {
          status.textContent = 'Preparo le immagini: ' + completed + ' di ' + total;
        } else if (value.message) {
          status.textContent = String(value.message);
        }
      },
      close: function () {
        if (closed) return;
        closed = true;
        documentRef.removeEventListener('keydown', onKeydown);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
          previousFocus.focus();
        }
      },
      element: overlay
    };
  }

  global.PrintProgressView = {
    open: open
  };
})(typeof window !== 'undefined' ? window : globalThis);
