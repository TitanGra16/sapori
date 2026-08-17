/**
 * Regole pure per conservare i conflitti di sincronizzazione senza perdita.
 */
(function () {
  'use strict';

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce(function (result, key) {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  function localContent(recipe) {
    if (!window.SyncSerializer || !recipe) return null;
    return window.SyncSerializer.serializeContent(recipe).recipe;
  }

  function contentEquals(localRecipe, remoteContent) {
    if (!localRecipe || !remoteContent || typeof remoteContent !== 'object') return false;
    return stableStringify(localContent(localRecipe)) === stableStringify(remoteContent);
  }

  function hash(value) {
    var result = 2166136261;
    var input = String(value || '');
    for (var index = 0; index < input.length; index++) {
      result ^= input.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function buildConflictId(ownerScope, entityId, revision, channels) {
    return [
      ownerScope,
      'recipe',
      entityId,
      Number(revision) || 0,
      Array.from(channels || []).sort().join(',') || 'content'
    ].join('|');
  }

  function buildSettingsConflictId(ownerScope, revision) {
    return [
      ownerScope,
      'settings',
      'customCategories',
      Number(revision) || 0,
      'categories-limit'
    ].join('|');
  }

  function buildCopyId(originalId, conflictId, existingIds) {
    var suffix = '-conflitto-' + hash(conflictId);
    var base = String(originalId || 'ricetta').replace(/[^A-Za-z0-9_-]/g, '-');
    base = base.slice(0, Math.max(1, 128 - suffix.length));
    var candidate = base + suffix;
    var counter = 2;
    while (existingIds && existingIds.has(candidate)) {
      var numberedSuffix = suffix + '-' + counter;
      candidate = base.slice(0, Math.max(1, 128 - numberedSuffix.length)) + numberedSuffix;
      counter++;
    }
    return candidate;
  }

  function copyName(name, timestamp) {
    var date = new Date(Number(timestamp) || Date.now());
    var label;
    try {
      label = new Intl.DateTimeFormat('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(date);
    } catch (error) {
      label = date.toISOString().slice(0, 10);
    }
    var base = String(name || 'Ricetta').trim() || 'Ricetta';
    var suffix = ' - copia in conflitto del ' + label;
    return base.slice(0, Math.max(1, 200 - suffix.length)) + suffix;
  }

  function mergeCategories(localValue, remoteItems) {
    var localPayload = window.SyncSerializer
      ? window.SyncSerializer.serializeCategories(localValue)
      : { items: [] };
    var remotePayload = window.SyncSerializer
      ? window.SyncSerializer.serializeCategories(remoteItems)
      : { items: [] };
    var byId = new Map();
    // Inserisce prima gli elementi locali: anche quando l'unione supera il
    // limite, nessuna categoria creata su questo dispositivo viene scartata.
    localPayload.items.forEach(function (item) { byId.set(item.id, item); });
    remotePayload.items.forEach(function (item) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    });
    return Array.from(byId.values());
  }

  function createRecord(options) {
    options = options || {};
    return {
      id: options.id,
      ownerScope: options.ownerScope,
      entityType: options.entityType || 'recipe',
      entityId: options.entityId,
      channels: Array.from(options.channels || []).sort(),
      preservedRecipeId: options.preservedRecipeId || null,
      remoteRevision: Number(options.remoteRevision) || 0,
      status: 'open',
      createdAt: Number(options.createdAt) || Date.now(),
      resolvedAt: null,
      details: options.details && typeof options.details === 'object'
        ? options.details
        : null
    };
  }

  window.SyncConflicts = Object.freeze({
    stableStringify: stableStringify,
    contentEquals: contentEquals,
    buildConflictId: buildConflictId,
    buildSettingsConflictId: buildSettingsConflictId,
    buildCopyId: buildCopyId,
    copyName: copyName,
    mergeCategories: mergeCategories,
    createRecord: createRecord
  });
})();
