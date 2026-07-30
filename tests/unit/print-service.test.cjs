const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppScripts } = require('../helpers/load-app.cjs');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      if (listeners.has(type)) listeners.get(type).delete(callback);
    },
    dispatch(type, event = {}) {
      Array.from(listeners.get(type) || []).forEach(callback => callback(event));
    },
    count(type) {
      return (listeners.get(type) || new Set()).size;
    }
  };
}

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); },
    values
  };
}

class FakeNode {
  constructor(value, nodeType = 1) {
    this.value = value;
    this.nodeType = nodeType;
    this.parentNode = null;
  }
}

class FakeFragment extends FakeNode {
  constructor() {
    super('fragment', 11);
    this.childNodes = [];
  }

  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
}

class FakeContainer extends FakeNode {
  constructor(documentRef, value = 'container') {
    super(value);
    this.ownerDocument = documentRef;
    this.children = [];
    this.images = [];
    this.removals = 0;
  }

  appendChild(node) {
    if (node.nodeType === 11) {
      const children = node.childNodes.slice();
      node.childNodes.length = 0;
      children.forEach(child => {
        child.parentNode = this;
        this.children.push(child);
      });
      return node;
    }
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
    this.removals += 1;
    return node;
  }

  querySelectorAll(selector) {
    return selector === 'img' ? this.images.slice() : [];
  }
}

function fakeDocument(title = 'Sapori') {
  return {
    title,
    defaultView: null,
    fonts: { ready: Promise.resolve() },
    body: { classList: classList() },
    createDocumentFragment() {
      return new FakeFragment();
    }
  };
}

function image(options = {}) {
  const events = eventTarget();
  return {
    complete: options.complete === true,
    naturalWidth: options.naturalWidth === undefined ? 0 : options.naturalWidth,
    decode: options.decode,
    addEventListener: events.addEventListener,
    removeEventListener: events.removeEventListener,
    load(width = 100) {
      this.complete = true;
      this.naturalWidth = width;
      events.dispatch('load');
    },
    fail() {
      this.complete = true;
      this.naturalWidth = 0;
      events.dispatch('error');
    }
  };
}

function loadPrintService(options = {}) {
  const windowEvents = eventTarget();
  const mediaEvents = eventTarget();
  const media = {
    matches: false,
    addEventListener: mediaEvents.addEventListener,
    removeEventListener: mediaEvents.removeEventListener,
    setMatches(value) {
      this.matches = value;
      mediaEvents.dispatch('change', { matches: value });
    }
  };
  const documentRef = options.document || fakeDocument();
  const print = options.print || (() => windowEvents.dispatch('afterprint'));
  const context = loadAppScripts(['js/print/print-service.js'], {
    document: documentRef,
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
    matchMedia: query => {
      assert.equal(query, 'print');
      return media;
    },
    requestAnimationFrame: callback => {
      callback(0);
      return 1;
    },
    print
  });
  documentRef.defaultView = context;
  return { context, documentRef, windowEvents, media };
}

test('attende immagini caricate, fallite e decodificate senza bloccare il documento', async () => {
  const { context, documentRef } = loadPrintService();
  const root = new FakeContainer(documentRef, 'root');
  const ready = image({
    complete: true,
    naturalWidth: 320,
    decode: async () => {}
  });
  const delayed = image();
  const broken = image();
  root.images = [ready, delayed, broken];
  const progress = [];

  const waiting = context.PrintService.waitForImages(root, {
    timeoutMs: 100,
    onProgress: update => progress.push(update.completed)
  });
  delayed.load(200);
  broken.fail();

  const summary = await waiting;
  assert.deepEqual(
    { ...summary },
    { total: 3, loaded: 2, failed: 1, timedOut: 0 }
  );
  assert.deepEqual(progress.slice().sort((a, b) => a - b), [1, 2, 3]);
});

test('limita la decodifica simultanea delle immagini nei ricettari grandi', async () => {
  const { context, documentRef } = loadPrintService();
  const root = new FakeContainer(documentRef, 'root');
  let active = 0;
  let maximum = 0;
  root.images = Array.from({ length: 12 }, () => image({
    complete: true,
    naturalWidth: 320,
    decode: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 3));
      active -= 1;
    }
  }));

  const summary = await context.PrintService.waitForImages(root, {
    concurrency: 3
  });

  assert.equal(summary.loaded, 12);
  assert.equal(maximum, 3);
});

test('ripristina il titolo una sola volta anche quando l’operazione fallisce', async () => {
  const { context, documentRef } = loadPrintService();
  const restore = context.PrintService.setTemporaryTitle('Ricetta da stampare', documentRef);
  assert.equal(documentRef.title, 'Ricetta da stampare');
  restore();
  restore();
  assert.equal(documentRef.title, 'Sapori');

  await assert.rejects(
    context.PrintService.withTemporaryTitle('PDF', async () => {
      assert.equal(documentRef.title, 'PDF');
      throw new Error('stampa fallita');
    }, documentRef),
    /stampa fallita/
  );
  assert.equal(documentRef.title, 'Sapori');
});

test('completa il ciclo tramite afterprint e rimuove gli osservatori', async () => {
  const { context, windowEvents } = loadPrintService();
  const watcher = context.PrintService.createPrintCompletionWatcher(context);
  assert.equal(windowEvents.count('afterprint'), 1);

  windowEvents.dispatch('afterprint');
  assert.deepEqual({ ...(await watcher.promise) }, { source: 'afterprint' });
  assert.equal(windowEvents.count('afterprint'), 0);
  watcher.dispose();
  watcher.dispose();
});

test('usa il ritorno da matchMedia print quando afterprint non arriva', async () => {
  const { context, media } = loadPrintService();
  const watcher = context.PrintService.createPrintCompletionWatcher(context);

  media.setMatches(true);
  media.setMatches(false);
  assert.deepEqual({ ...(await watcher.promise) }, { source: 'match-media' });
});

test('usa una protezione lunga configurabile se il browser non invia altri segnali', async () => {
  const { context } = loadPrintService();
  const watcher = context.PrintService.createPrintCompletionWatcher(context, {
    timeoutMs: 5
  });

  assert.deepEqual({ ...(await watcher.promise) }, { source: 'safety-timeout' });
});

test('stampa dopo il layout e ripulisce titolo, classe e DOM solo alla chiusura', async () => {
  const documentRef = fakeDocument('Sapori originale');
  const phases = [];
  const { context, windowEvents } = loadPrintService({ document: documentRef });

  const parent = new FakeContainer(documentRef, 'parent');
  const root = new FakeContainer(documentRef, 'print-root');
  parent.appendChild(root);

  const result = await context.PrintService.printDocument(root, {
    document: documentRef,
    window: context,
    bodyClass: 'printing-recipe',
    title: 'Ricetta — Sapori',
    onProgress: update => phases.push(update.phase)
  });

  assert.equal(result.completion.source, 'afterprint');
  assert.deepEqual(phases, ['preparing', 'ready', 'dialog', 'complete']);
  assert.equal(documentRef.title, 'Sapori originale');
  assert.equal(documentRef.body.classList.contains('printing-recipe'), false);
  assert.equal(root.parentNode, null);
  assert.equal(parent.removals, 1);

  windowEvents.dispatch('afterprint');
  assert.equal(parent.removals, 1);
});

test('costruisce il DOM in lotti ordinati con progresso e yield cooperativo', async () => {
  const { context, documentRef } = loadPrintService();
  const container = new FakeContainer(documentRef);
  const progress = [];
  let yields = 0;

  const result = await context.PrintService.buildInBatches(
    container,
    ['a', 'b', 'c', 'd', 'e'],
    value => new FakeNode(value),
    {
      batchSize: 2,
      schedule: async () => { yields += 1; },
      onProgress: update => progress.push(update.completed)
    }
  );

  assert.deepEqual({ ...result }, { completed: 5, total: 5 });
  assert.deepEqual(container.children.map(node => node.value), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(progress, [0, 2, 4, 5]);
  assert.equal(yields, 2);
});

test('l’annullamento rimuove solo i nodi aggiunti dalla costruzione corrente', async () => {
  const { context, documentRef } = loadPrintService();
  const container = new FakeContainer(documentRef);
  const existing = new FakeNode('esistente');
  container.appendChild(existing);
  const controller = new AbortController();

  await assert.rejects(
    context.PrintService.buildInBatches(
      container,
      ['uno', 'due', 'tre'],
      (value, index) => {
        if (index === 1) controller.abort();
        return new FakeNode(value);
      },
      {
        batchSize: 1,
        signal: controller.signal,
        schedule: async () => {}
      }
    ),
    error => error && error.name === 'AbortError'
  );

  assert.deepEqual(container.children.map(node => node.value), ['esistente']);
  assert.equal(existing.parentNode, container);
});

test('il rollback rimuove anche i figli restituiti dentro un DocumentFragment', async () => {
  const { context, documentRef } = loadPrintService();
  const container = new FakeContainer(documentRef);
  const existing = new FakeNode('esistente');
  container.appendChild(existing);
  const controller = new AbortController();

  await assert.rejects(
    context.PrintService.buildInBatches(
      container,
      ['primo', 'secondo'],
      (value, index) => {
        if (index === 1) {
          controller.abort();
          return new FakeNode(value);
        }
        const fragment = new FakeFragment();
        fragment.appendChild(new FakeNode('figlio-a'));
        fragment.appendChild(new FakeNode('figlio-b'));
        return fragment;
      },
      {
        batchSize: 1,
        signal: controller.signal,
        schedule: async () => {}
      }
    ),
    error => error && error.name === 'AbortError'
  );

  assert.deepEqual(container.children.map(node => node.value), ['esistente']);
});
