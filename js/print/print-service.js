/**
 * Servizio di preparazione e stampa dei documenti di Sapori.
 *
 * Il modulo non conosce ricette o viste: riceve un DOM già costruito, attende
 * le risorse necessarie e governa il ciclo del dialogo di stampa. Offre inoltre
 * una costruzione DOM a lotti per ricettari molto grandi.
 */
(function (global) {
  'use strict';

  var activePrint = false;
  var DEFAULT_IMAGE_CONCURRENCY = 6;
  var DEFAULT_COMPLETION_TIMEOUT_MS = 10 * 60 * 1000;

  function createAbortError(message) {
    var text = message || 'Operazione annullata';
    if (typeof DOMException === 'function') {
      return new DOMException(text, 'AbortError');
    }
    var error = new Error(text);
    error.name = 'AbortError';
    return error;
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) {
      throw createAbortError();
    }
  }

  function once(callback) {
    var called = false;
    return function () {
      if (called) return;
      called = true;
      return callback.apply(this, arguments);
    };
  }

  function raceWithAbort(value, signal) {
    if (!signal) return Promise.resolve(value);
    throwIfAborted(signal);

    return new Promise(function (resolve, reject) {
      var settled = false;
      var finish = function (handler, result) {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        handler(result);
      };
      var onAbort = function () {
        finish(reject, createAbortError());
      };

      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(value).then(
        function (result) { finish(resolve, result); },
        function (error) { finish(reject, error); }
      );
    });
  }

  function waitForImage(image, options) {
    options = options || {};
    var signal = options.signal;
    var timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Math.max(0, Number(options.timeoutMs))
      : 30000;

    throwIfAborted(signal);

    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = null;

      var cleanup = function () {
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (timer !== null) {
          global.clearTimeout(timer);
          timer = null;
        }
      };

      var finish = function (status) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ image: image, status: status });
      };

      var fail = function (error) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      var finishLoaded = function () {
        if (typeof image.decode !== 'function') {
          finish('loaded');
          return;
        }

        Promise.resolve()
          .then(function () { return image.decode(); })
          .then(
            function () { finish('loaded'); },
            function () {
              // Alcuni browser rifiutano decode() anche se l'immagine è già
              // stata decodificata correttamente dal motore di rendering.
              finish(image.naturalWidth > 0 ? 'loaded' : 'failed');
            }
          );
      };

      var onLoad = function () {
        finishLoaded();
      };
      var onError = function () {
        finish('failed');
      };
      var onAbort = function () {
        fail(createAbortError());
      };

      image.addEventListener('load', onLoad, { once: true });
      image.addEventListener('error', onError, { once: true });
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      if (timeoutMs > 0) {
        timer = global.setTimeout(function () {
          finish('timed-out');
        }, timeoutMs);
      }

      if (image.complete) {
        if (image.naturalWidth === 0) finish('failed');
        else finishLoaded();
      }
    });
  }

  /**
   * Attende tutte le immagini senza far fallire la stampa per una singola
   * risorsa non caricabile. Un AbortSignal annulla invece l'intera attesa.
   */
  async function waitForImages(root, options) {
    options = options || {};
    if (!root || typeof root.querySelectorAll !== 'function') {
      throw new Error('Contenitore immagini non valido');
    }

    var images = Array.from(root.querySelectorAll('img'));
    var completed = 0;
    var onProgress = typeof options.onProgress === 'function'
      ? options.onProgress
      : null;

    var requestedConcurrency = Number(options.concurrency);
    var concurrency = Number.isInteger(requestedConcurrency) && requestedConcurrency > 0
      ? Math.min(requestedConcurrency, 24)
      : DEFAULT_IMAGE_CONCURRENCY;
    var results = new Array(images.length);
    var nextIndex = 0;

    async function worker() {
      while (nextIndex < images.length) {
        var index = nextIndex;
        nextIndex += 1;
        var result = await waitForImage(images[index], options);
        results[index] = result;
        completed += 1;
        if (onProgress) {
          await onProgress({
            phase: 'images',
            completed: completed,
            total: images.length,
            status: result.status
          });
        }
      }
    }

    var workers = [];
    for (var index = 0; index < Math.min(concurrency, images.length); index += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);

    return results.reduce(function (summary, result) {
      summary[result.status === 'timed-out' ? 'timedOut' : result.status] += 1;
      return summary;
    }, {
      total: images.length,
      loaded: 0,
      failed: 0,
      timedOut: 0
    });
  }

  async function waitForFonts(documentRef, signal) {
    if (!documentRef || !documentRef.fonts || !documentRef.fonts.ready) {
      return { supported: false, ready: true };
    }

    try {
      await raceWithAbort(documentRef.fonts.ready, signal);
      return { supported: true, ready: true };
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      return { supported: true, ready: false };
    }
  }

  function nextFrame(windowRef, signal) {
    var framePromise = new Promise(function (resolve) {
      if (windowRef && typeof windowRef.requestAnimationFrame === 'function') {
        windowRef.requestAnimationFrame(function () { resolve(); });
      } else {
        global.setTimeout(resolve, 0);
      }
    });
    return raceWithAbort(framePromise, signal);
  }

  async function waitForResources(root, options) {
    options = options || {};
    var documentRef = options.document ||
      (root && root.ownerDocument) ||
      global.document;
    var windowRef = options.window ||
      (documentRef && documentRef.defaultView) ||
      global;
    var signal = options.signal;

    throwIfAborted(signal);
    var results = await Promise.all([
      waitForImages(root, {
        signal: signal,
        timeoutMs: options.imageTimeoutMs,
        concurrency: options.imageConcurrency,
        onProgress: options.onImageProgress
      }),
      waitForFonts(documentRef, signal)
    ]);

    // Due frame assicurano che classi di stampa, immagini e font abbiano
    // prodotto almeno un layout completo prima di aprire il dialogo.
    await nextFrame(windowRef, signal);
    await nextFrame(windowRef, signal);

    return {
      images: results[0],
      fonts: results[1]
    };
  }

  /**
   * Imposta un titolo e restituisce un ripristino idempotente.
   */
  function setTemporaryTitle(title, documentRef) {
    documentRef = documentRef || global.document;
    if (!documentRef) throw new Error('Documento non disponibile');

    var previousTitle = documentRef.title;
    if (title !== undefined && title !== null) {
      documentRef.title = String(title);
    }

    return once(function () {
      documentRef.title = previousTitle;
    });
  }

  async function withTemporaryTitle(title, task, documentRef) {
    if (typeof task !== 'function') {
      throw new Error('Operazione con titolo temporaneo non valida');
    }
    var restore = setTemporaryTitle(title, documentRef);
    try {
      return await task();
    } finally {
      restore();
    }
  }

  /**
   * Osserva la reale chiusura del dialogo di stampa.
   *
   * afterprint è il segnale principale; matchMedia, ritorno del focus e
   * visibilitychange coprono browser e WebView meno completi. Una protezione
   * lunga e configurabile evita infine di lasciare l'app bloccata per sempre,
   * senza ripetere il vecchio ripristino arbitrario dopo due secondi.
   */
  function createPrintCompletionWatcher(windowRef, options) {
    options = options || {};
    windowRef = windowRef || global;
    if (!windowRef || typeof windowRef.addEventListener !== 'function') {
      throw new Error('Finestra di stampa non valida');
    }

    var settled = false;
    var mediaQuery = typeof windowRef.matchMedia === 'function'
      ? windowRef.matchMedia('print')
      : null;
    var documentRef = options.document || windowRef.document || null;
    var timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Math.max(0, Number(options.timeoutMs))
      : DEFAULT_COMPLETION_TIMEOUT_MS;
    var enteredPrintMedia = Boolean(mediaQuery && mediaQuery.matches);
    var windowBlurred = false;
    var documentWasHidden = Boolean(documentRef && documentRef.hidden);
    var timeoutId = null;
    var resolvePromise;
    var promise = new Promise(function (resolve) {
      resolvePromise = resolve;
    });

    var removeListeners = once(function () {
      windowRef.removeEventListener('afterprint', onAfterPrint);
      windowRef.removeEventListener('blur', onBlur);
      windowRef.removeEventListener('focus', onFocus);
      if (documentRef && typeof documentRef.removeEventListener === 'function') {
        documentRef.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (mediaQuery) {
        if (typeof mediaQuery.removeEventListener === 'function') {
          mediaQuery.removeEventListener('change', onMediaChange);
        } else if (typeof mediaQuery.removeListener === 'function') {
          mediaQuery.removeListener(onMediaChange);
        }
      }
      if (timeoutId !== null) {
        global.clearTimeout(timeoutId);
        timeoutId = null;
      }
    });

    var complete = function (source) {
      if (settled) return;
      settled = true;
      removeListeners();
      resolvePromise({ source: source });
    };
    var onAfterPrint = function () {
      complete('afterprint');
    };
    var onMediaChange = function (event) {
      if (event.matches) {
        enteredPrintMedia = true;
      } else if (enteredPrintMedia) {
        complete('match-media');
      }
    };
    var onBlur = function () {
      windowBlurred = true;
    };
    var onFocus = function () {
      if (windowBlurred && (!mediaQuery || !mediaQuery.matches)) {
        complete('focus');
      }
    };
    var onVisibilityChange = function () {
      if (!documentRef) return;
      if (documentRef.hidden) {
        documentWasHidden = true;
      } else if (documentWasHidden && (!mediaQuery || !mediaQuery.matches)) {
        complete('visibility');
      }
    };

    windowRef.addEventListener('afterprint', onAfterPrint);
    windowRef.addEventListener('blur', onBlur);
    windowRef.addEventListener('focus', onFocus);
    if (documentRef && typeof documentRef.addEventListener === 'function') {
      documentRef.addEventListener('visibilitychange', onVisibilityChange);
    }
    if (mediaQuery) {
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', onMediaChange);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(onMediaChange);
      }
    }
    if (timeoutMs > 0) {
      timeoutId = global.setTimeout(function () {
        complete('safety-timeout');
      }, timeoutMs);
    }

    return {
      promise: promise,
      complete: complete,
      dispose: removeListeners
    };
  }

  async function notify(callback, payload) {
    if (typeof callback !== 'function') return;
    return callback(payload);
  }

  /**
   * Prepara, stampa e ripulisce un documento già collegato al DOM.
   *
   * L'annullamento è accettato durante la preparazione; dopo window.print()
   * la pulizia attende sempre un vero segnale di chiusura del dialogo.
   */
  async function printDocument(printRoot, options) {
    options = options || {};
    if (!printRoot || !printRoot.parentNode) {
      throw new Error('Documento di stampa non collegato al DOM');
    }
    if (activePrint) {
      throw new Error('È già in corso un’altra stampa');
    }

    var documentRef = options.document || printRoot.ownerDocument || global.document;
    var windowRef = options.window ||
      (documentRef && documentRef.defaultView) ||
      global;
    if (!documentRef || !documentRef.body ||
        !windowRef || typeof windowRef.print !== 'function') {
      throw new Error('Ambiente di stampa non disponibile');
    }

    var bodyClass = options.bodyClass ? String(options.bodyClass).trim() : '';
    var removeRoot = options.removeRoot !== false;
    var signal = options.signal;
    var onProgress = options.onProgress;
    var watcher = null;
    var classAdded = false;
    var restoreTitle = setTemporaryTitle(options.title, documentRef);

    activePrint = true;
    var cleanup = once(function () {
      if (watcher) watcher.dispose();
      if (classAdded) documentRef.body.classList.remove(bodyClass);
      if (removeRoot && printRoot.parentNode) {
        printRoot.parentNode.removeChild(printRoot);
      }
      restoreTitle();
      activePrint = false;
    });

    try {
      if (bodyClass && !documentRef.body.classList.contains(bodyClass)) {
        documentRef.body.classList.add(bodyClass);
        classAdded = true;
      }

      await notify(onProgress, { phase: 'preparing' });
      var resources = await waitForResources(printRoot, {
        document: documentRef,
        window: windowRef,
        signal: signal,
        imageTimeoutMs: options.imageTimeoutMs,
        imageConcurrency: options.imageConcurrency,
        onImageProgress: options.onImageProgress
      });
      throwIfAborted(signal);
      await notify(onProgress, { phase: 'ready', resources: resources });

      watcher = createPrintCompletionWatcher(windowRef, {
        document: documentRef,
        timeoutMs: options.completionTimeoutMs
      });
      await notify(onProgress, { phase: 'dialog' });
      var printResult = windowRef.print();
      var completion;

      if (printResult && typeof printResult.then === 'function') {
        completion = await Promise.race([
          watcher.promise,
          Promise.resolve(printResult).then(function () {
            watcher.complete('print-promise');
            return watcher.promise;
          })
        ]);
      } else {
        completion = await watcher.promise;
      }

      await notify(onProgress, {
        phase: 'complete',
        completion: completion,
        resources: resources
      });
      return {
        completion: completion,
        resources: resources
      };
    } finally {
      cleanup();
    }
  }

  function defaultScheduler(windowRef) {
    if (windowRef && windowRef.scheduler &&
        typeof windowRef.scheduler.yield === 'function') {
      return function () { return windowRef.scheduler.yield(); };
    }
    if (windowRef && typeof windowRef.requestAnimationFrame === 'function') {
      return function () {
        return new Promise(function (resolve) {
          windowRef.requestAnimationFrame(function () { resolve(); });
        });
      };
    }
    return function () {
      return new Promise(function (resolve) {
        global.setTimeout(resolve, 0);
      });
    };
  }

  function normalizeNodes(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) {
      return value.reduce(function (nodes, item) {
        return nodes.concat(normalizeNodes(item));
      }, []);
    }
    if (typeof value === 'string' || typeof value.nodeType !== 'number') {
      throw new Error('Il renderer deve restituire nodi DOM');
    }
    if (value.nodeType === 11) {
      return Array.from(value.childNodes || []).reduce(function (nodes, item) {
        return nodes.concat(normalizeNodes(item));
      }, []);
    }
    return [value];
  }

  /**
   * Costruisce un contenitore per lotti, mantenendo responsiva l'interfaccia.
   *
   * `onProgress` può restituire false per annullare. AbortSignal è controllato
   * prima e dopo ogni elemento. In caso di errore/annullamento vengono rimossi
   * soltanto i nodi aggiunti da questa chiamata, salvo rollbackOnError=false.
   */
  async function buildInBatches(container, items, renderItem, options) {
    options = options || {};
    if (!container || typeof container.appendChild !== 'function' ||
        !container.ownerDocument ||
        typeof container.ownerDocument.createDocumentFragment !== 'function') {
      throw new Error('Contenitore DOM non valido');
    }
    if (!Array.isArray(items)) {
      throw new Error('La costruzione a lotti richiede un array');
    }
    if (typeof renderItem !== 'function') {
      throw new Error('Renderer DOM non valido');
    }

    var numericBatchSize = Number(options.batchSize);
    var batchSize = Number.isInteger(numericBatchSize) && numericBatchSize > 0
      ? Math.min(numericBatchSize, 1000)
      : 25;
    var signal = options.signal;
    var onProgress = options.onProgress;
    var rollbackOnError = options.rollbackOnError !== false;
    var windowRef = options.window ||
      container.ownerDocument.defaultView ||
      global;
    var schedule = typeof options.schedule === 'function'
      ? options.schedule
      : defaultScheduler(windowRef);
    var appendedNodes = [];
    var completed = 0;

    var report = async function () {
      if (typeof onProgress !== 'function') return;
      var result = await onProgress({
        phase: 'building',
        completed: completed,
        total: items.length,
        percent: items.length === 0
          ? 100
          : Math.round((completed / items.length) * 100)
      });
      if (result === false) throw createAbortError();
    };

    var rollback = function () {
      appendedNodes.slice().reverse().forEach(function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
    };

    try {
      throwIfAborted(signal);
      await report();

      for (var start = 0; start < items.length; start += batchSize) {
        var end = Math.min(start + batchSize, items.length);
        var fragment = container.ownerDocument.createDocumentFragment();
        var batchNodes = [];

        for (var index = start; index < end; index += 1) {
          throwIfAborted(signal);
          var rendered = await raceWithAbort(
            Promise.resolve(renderItem(items[index], index, signal)),
            signal
          );
          throwIfAborted(signal);
          normalizeNodes(rendered).forEach(function (node) {
            batchNodes.push(node);
            fragment.appendChild(node);
          });
        }

        throwIfAborted(signal);
        container.appendChild(fragment);
        appendedNodes.push.apply(appendedNodes, batchNodes);
        completed = end;
        await report();

        if (completed < items.length) {
          await raceWithAbort(Promise.resolve().then(schedule), signal);
        }
      }

      return {
        completed: completed,
        total: items.length
      };
    } catch (error) {
      if (rollbackOnError) rollback();
      throw error;
    }
  }

  global.PrintService = {
    DEFAULT_IMAGE_CONCURRENCY: DEFAULT_IMAGE_CONCURRENCY,
    DEFAULT_COMPLETION_TIMEOUT_MS: DEFAULT_COMPLETION_TIMEOUT_MS,
    waitForImages: waitForImages,
    waitForResources: waitForResources,
    setTemporaryTitle: setTemporaryTitle,
    withTemporaryTitle: withTemporaryTitle,
    createPrintCompletionWatcher: createPrintCompletionWatcher,
    printDocument: printDocument,
    buildInBatches: buildInBatches
  };
})(typeof window !== 'undefined' ? window : globalThis);
