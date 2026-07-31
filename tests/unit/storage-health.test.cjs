const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppScripts } = require('../helpers/load-app.cjs');

function createContext(storage) {
  return loadAppScripts(['js/data/storage-health.js'], {
    navigator: { storage }
  });
}

test('legge e normalizza quota, utilizzo e persistenza senza chiedere permessi', async () => {
  let persistCalls = 0;
  const context = createContext({
    estimate: async () => ({ usage: 750, quota: 1000 }),
    persisted: async () => false,
    persist: async () => {
      persistCalls++;
      return true;
    }
  });

  const health = await context.StorageHealth.read();
  assert.equal(persistCalls, 0);
  assert.equal(health.supported, true);
  assert.equal(health.usageBytes, 750);
  assert.equal(health.quotaBytes, 1000);
  assert.equal(health.availableBytes, 250);
  assert.equal(health.usageRatio, 0.75);
  assert.equal(health.usagePercent, 75);
  assert.equal(health.level, 'warning');
  assert.equal(health.persisted, false);
  assert.equal(health.persistenceRequestSupported, true);
});

test('applica soglie sane e limita i valori incoerenti del browser', async () => {
  const criticalContext = createContext({
    estimate: async () => ({ usage: 150.4, quota: 100.2 })
  });
  const critical = await criticalContext.StorageHealth.read();
  assert.equal(critical.usageBytes, 150);
  assert.equal(critical.quotaBytes, 100);
  assert.equal(critical.availableBytes, 0);
  assert.equal(critical.usageRatio, 1);
  assert.equal(critical.usagePercent, 100);
  assert.equal(critical.level, 'critical');

  const healthyContext = createContext({
    estimate: async () => ({ usage: 100, quota: 1000 })
  });
  assert.equal((await healthyContext.StorageHealth.read()).level, 'healthy');

  const unknownContext = createContext({
    estimate: async () => ({ usage: -1, quota: 0 })
  });
  const unknown = await unknownContext.StorageHealth.read();
  assert.equal(unknown.usageBytes, null);
  assert.equal(unknown.quotaBytes, null);
  assert.equal(unknown.usageRatio, null);
  assert.equal(unknown.level, 'unknown');
});

test('isola gli errori delle API di lettura e restituisce uno stato utilizzabile', async () => {
  const context = createContext({
    estimate: async () => {
      throw new Error('stima negata');
    },
    persisted: async () => {
      throw new Error('stato non disponibile');
    }
  });

  const health = await context.StorageHealth.read();
  assert.equal(health.supported, true);
  assert.equal(health.usageBytes, null);
  assert.equal(health.persisted, null);
  assert.equal(health.level, 'unknown');
  assert.match(health.errors.estimate, /stima negata/);
  assert.match(health.errors.persisted, /stato non disponibile/);
});

test('richiede la persistenza soltanto tramite il metodo esplicito', async () => {
  let persisted = false;
  let persistCalls = 0;
  const context = createContext({
    estimate: async () => ({ usage: 10, quota: 100 }),
    persisted: async () => persisted,
    persist: async () => {
      persistCalls++;
      persisted = true;
      return true;
    }
  });

  await context.StorageHealth.read();
  assert.equal(persistCalls, 0);

  const result = await context.StorageHealth.requestPersistence();
  assert.equal(persistCalls, 1);
  assert.equal(result.persistenceRequested, true);
  assert.equal(result.persistenceGranted, true);
  assert.equal(result.persisted, true);
  assert.equal(result.requestError, null);
});

test('distingue un rifiuto esplicito e formatta le dimensioni in italiano', async () => {
  const context = createContext({
    estimate: async () => ({ usage: 1536, quota: 1024 * 1024 }),
    persisted: async () => false,
    persist: async () => false
  });

  const result = await context.StorageHealth.requestPersistence();
  assert.equal(result.persistenceRequested, true);
  assert.equal(result.persistenceGranted, false);
  assert.equal(result.persisted, false);
  assert.equal(result.requestError, null);
  assert.equal(context.StorageHealth.formatBytes(0), '0 B');
  assert.match(context.StorageHealth.formatBytes(1536), /^1,5 KB$/);
  assert.equal(context.StorageHealth.formatBytes(null), 'Non disponibile');
});

test('non blocca le impostazioni se le API del browser non rispondono', async () => {
  const never = new Promise(() => {});
  const context = createContext({
    estimate: () => never,
    persisted: () => never
  });

  const health = await context.StorageHealth.read({ timeoutMs: 5 });
  assert.equal(health.usageBytes, null);
  assert.equal(health.persisted, null);
  assert.match(health.errors.estimate, /non ha risposto in tempo/);
  assert.match(health.errors.persisted, /non ha risposto in tempo/);
});

test('normalizza il rifiuto e l’assenza della richiesta di persistenza', async () => {
  const rejectedContext = createContext({
    estimate: async () => ({ usage: 1, quota: 10 }),
    persist: async () => {
      throw new Error('richiesta rifiutata');
    }
  });
  const rejected = await rejectedContext.StorageHealth.requestPersistence();
  assert.equal(rejected.persistenceRequested, true);
  assert.equal(rejected.persistenceGranted, null);
  assert.match(rejected.requestError, /richiesta rifiutata/);

  const unsupportedContext = createContext({
    estimate: async () => ({ usage: 1, quota: 10 })
  });
  const unsupported = await unsupportedContext.StorageHealth.requestPersistence();
  assert.equal(unsupported.persistenceRequested, false);
  assert.equal(unsupported.persistenceGranted, null);
  assert.equal(unsupported.requestError, null);
});

test('restituisce valori neutri quando StorageManager non esiste', async () => {
  const context = loadAppScripts(['js/data/storage-health.js']);
  const health = await context.StorageHealth.read();
  assert.equal(health.supported, false);
  assert.equal(health.usageBytes, null);
  assert.equal(health.quotaBytes, null);
  assert.equal(health.persisted, null);
  assert.equal(health.level, 'unknown');
});
