/**
 * Coordina autosalvataggio, ripristino e rimozione delle bozze del modulo.
 * Il controller dell'app fornisce soltanto le funzioni per leggere il form e
 * stabilire se contiene modifiche.
 */
(function (global) {
  'use strict';

  function createId(prefix) {
    var random = global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    return String(prefix || 'draft') + '-' + random;
  }

  var writerId = createId('tab');

  function open(options) {
    options = options || {};
    if (!global.DraftStore) throw new Error('Archivio bozze non disponibile');
    if (!options.target || typeof options.read !== 'function' ||
        typeof options.isDirty !== 'function') {
      throw new Error('Configurazione autosalvataggio non valida');
    }

    var target = {
      mode: options.target.mode,
      recipeId: options.target.recipeId || null,
      draftId: options.target.draftId
    };
    var delay = Number.isFinite(Number(options.delay))
      ? Math.max(100, Number(options.delay))
      : 600;
    var onStatus = typeof options.onStatus === 'function'
      ? options.onStatus
      : function () {};
    var timer = null;
    var revision = null;
    var closed = false;
    var closing = false;
    var closePromise = null;
    var operation = Promise.resolve();
    var changeVersion = 0;
    var savedVersion = 0;

    function notify(status, details) {
      try {
        onStatus(status, details || {});
      } catch (error) {
        console.warn('Impossibile aggiornare lo stato della bozza:', error);
      }
    }

    function enqueue(task) {
      operation = operation.catch(function () {}).then(task);
      return operation;
    }

    async function persistCurrent() {
      if (closed) return null;
      if (revision !== null && savedVersion === changeVersion) return null;
      if (!options.isDirty()) {
        if (revision !== null) {
          var removed = await global.DraftStore.remove(target, {
            expectedRevision: revision
          });
          if (removed) revision = null;
        }
        savedVersion = changeVersion;
        notify('empty');
        return null;
      }

      notify('saving');
      var versionBeingSaved = changeVersion;
      var record = await global.DraftStore.save(target, options.read(), {
        writerId: writerId
      });
      revision = record.revision;
      savedVersion = versionBeingSaved;
      notify('saved', record);
      return record;
    }

    function schedule() {
      if (closed || closing) return;
      changeVersion += 1;
      if (timer !== null) global.clearTimeout(timer);
      notify('pending');
      timer = global.setTimeout(function () {
        timer = null;
        enqueue(persistCurrent).catch(function (error) {
          notify('error', { error: error });
        });
      }, delay);
    }

    function flush() {
      if (timer !== null) {
        global.clearTimeout(timer);
        timer = null;
      }
      if (closed) return operation;
      return enqueue(persistCurrent).catch(function (error) {
        notify('error', { error: error });
        throw error;
      });
    }

    async function restore() {
      if (closed) return null;
      var record = await global.DraftStore.get(target);
      if (record) {
        revision = record.revision;
        notify('recovered', record);
      } else {
        notify('empty');
      }
      return record;
    }

    function discard() {
      if (timer !== null) {
        global.clearTimeout(timer);
        timer = null;
      }
      return enqueue(async function () {
        var expectedRevision = revision;
        if (expectedRevision === null) {
          var current = await global.DraftStore.get(target);
          expectedRevision = current ? current.revision : null;
        }
        var removed = expectedRevision === null
          ? false
          : await global.DraftStore.remove(target, {
              expectedRevision: expectedRevision
            });
        if (removed) revision = null;
        savedVersion = changeVersion;
        notify('discarded', { removed: removed });
        return removed;
      });
    }

    function close(closeOptions) {
      if (closePromise) return closePromise;
      closeOptions = closeOptions || {};
      closing = true;

      closePromise = (async function () {
        var closeError = null;
        var result = null;

        if (closeOptions.flush !== false) {
          try {
            result = await flush();
          } catch (error) {
            closeError = error;
            console.warn('Impossibile completare il salvataggio della bozza:', error);
          }
        } else if (timer !== null) {
          global.clearTimeout(timer);
          timer = null;
        }

        closed = true;
        closing = false;
        try {
          result = await operation;
        } catch (operationError) {
          if (!closeError) closeError = operationError;
        }

        return {
          closed: true,
          result: result,
          error: closeError
        };
      })();

      return closePromise;
    }

    return {
      target: target,
      schedule: schedule,
      flush: flush,
      restore: restore,
      discard: discard,
      close: close,
      getRevision: function () { return revision; }
    };
  }

  global.DraftManager = {
    createId: createId,
    open: open
  };
})(typeof window !== 'undefined' ? window : globalThis);
