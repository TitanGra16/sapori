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
    var conflict = null;
    var closeOutcome = null;

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

    function createConflictFromRecord(record) {
      var error = new Error(
        record
          ? 'La bozza è stata modificata da un’altra scheda.'
          : 'La bozza attesa non esiste più.'
      );
      error.name = 'DraftStoreError';
      error.code = 'DRAFT_CONFLICT';
      error.currentRevision = record ? Number(record.revision) || null : null;
      error.currentWriterId = record && record.writerId ? record.writerId : null;
      return error;
    }

    function rememberConflict(error) {
      conflict = error;
      notify('conflict', { error: error });
      return error;
    }

    async function persistCurrent() {
      if (closed) return null;
      if (conflict) throw conflict;
      if (revision !== null && savedVersion === changeVersion) return null;
      if (!options.isDirty()) {
        if (revision !== null) {
          var removed = await global.DraftStore.remove(target, {
            expectedRevision: revision
          });
          if (removed) {
            revision = null;
          } else {
            var currentAfterRemove = await global.DraftStore.get(target);
            if (currentAfterRemove) {
              throw rememberConflict(createConflictFromRecord(currentAfterRemove));
            }
            revision = null;
          }
        }
        savedVersion = changeVersion;
        notify('empty');
        return null;
      }

      notify('saving');
      var versionBeingSaved = changeVersion;
      var record;
      try {
        record = await global.DraftStore.save(target, options.read(), {
          writerId: writerId,
          expectedRevision: revision
        });
      } catch (error) {
        if (error && error.code === 'DRAFT_CONFLICT') rememberConflict(error);
        throw error;
      }
      revision = record.revision;
      savedVersion = versionBeingSaved;
      conflict = null;
      notify('saved', record);
      return record;
    }

    function schedule() {
      if (closed || closing) return;
      changeVersion += 1;
      if (timer !== null) global.clearTimeout(timer);
      if (conflict) {
        notify('conflict', { error: conflict });
        return;
      }
      notify('pending');
      timer = global.setTimeout(function () {
        timer = null;
        enqueue(persistCurrent).catch(function (error) {
          notify(
            error && error.code === 'DRAFT_CONFLICT' ? 'conflict' : 'error',
            { error: error }
          );
        });
      }, delay);
    }

    function flush() {
      if (timer !== null) {
        global.clearTimeout(timer);
        timer = null;
      }
      if (closed) return operation;
      if (conflict) {
        notify('conflict', { error: conflict });
        return Promise.reject(conflict);
      }
      return enqueue(persistCurrent).catch(function (error) {
        notify(
          error && error.code === 'DRAFT_CONFLICT' ? 'conflict' : 'error',
          { error: error }
        );
        throw error;
      });
    }

    async function restore() {
      if (closed) return null;
      var record = await global.DraftStore.get(target);
      if (record) {
        revision = record.revision;
        conflict = null;
        notify('recovered', record);
      } else {
        revision = null;
        conflict = null;
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
          if (current) {
            var unknownRevisionConflict = rememberConflict(
              createConflictFromRecord(current)
            );
            savedVersion = changeVersion;
            return {
              status: 'conflict',
              removed: false,
              error: unknownRevisionConflict,
              currentRevision: current.revision,
              currentWriterId: current.writerId || null
            };
          }
          conflict = null;
          savedVersion = changeVersion;
          var missingResult = { status: 'not-found', removed: false };
          notify('discarded', missingResult);
          return missingResult;
        }

        var removed = await global.DraftStore.remove(target, {
          expectedRevision: expectedRevision
        });
        if (removed) {
          revision = null;
          conflict = null;
          savedVersion = changeVersion;
          var removedResult = { status: 'removed', removed: true };
          notify('discarded', removedResult);
          return removedResult;
        }

        var current = await global.DraftStore.get(target);
        if (!current) {
          revision = null;
          conflict = null;
          savedVersion = changeVersion;
          var disappearedResult = { status: 'not-found', removed: false };
          notify('discarded', disappearedResult);
          return disappearedResult;
        }

        var discardConflict = rememberConflict(createConflictFromRecord(current));
        savedVersion = changeVersion;
        return {
          status: 'conflict',
          removed: false,
          error: discardConflict,
          currentRevision: current.revision,
          currentWriterId: current.writerId || null
        };
      });
    }

    function close(closeOptions) {
      if (closed) return Promise.resolve(closeOutcome || {
        closed: true,
        result: null,
        error: null
      });
      if (closePromise) return closePromise;
      closeOptions = closeOptions || {};
      closing = true;

      var currentClosePromise = (async function () {
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

        if (closeError && closeOptions.forceClose !== true) {
          closing = false;
          return {
            closed: false,
            result: result,
            error: closeError
          };
        }

        closed = true;
        closing = false;
        try {
          result = await operation;
        } catch (operationError) {
          if (!closeError) closeError = operationError;
        }

        closeOutcome = {
          closed: true,
          result: result,
          error: closeError
        };
        return closeOutcome;
      })();

      closePromise = currentClosePromise;
      currentClosePromise.then(function (outcome) {
        if (!outcome.closed && closePromise === currentClosePromise) {
          closePromise = null;
        }
      }, function () {
        if (closePromise === currentClosePromise) closePromise = null;
      });
      return currentClosePromise;
    }

    return {
      target: target,
      schedule: schedule,
      flush: flush,
      restore: restore,
      discard: discard,
      close: close,
      getRevision: function () { return revision; },
      getConflict: function () { return conflict; },
      isClosed: function () { return closed; }
    };
  }

  global.DraftManager = {
    createId: createId,
    open: open
  };
})(typeof window !== 'undefined' ? window : globalThis);
