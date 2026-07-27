const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppScripts } = require('../helpers/load-app.cjs');

function luminance(hex) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('escapeHtml neutralizza markup e attributi', () => {
  const { Utils } = loadAppScripts(['js/utils.js']);
  assert.equal(
    Utils.escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
});

test('getContrastText garantisce almeno il contrasto AA per colori solidi', () => {
  const { Utils } = loadAppScripts(['js/utils.js']);
  const colors = ['#000000', '#18181B', '#777777', '#8B5CF6', '#FF6B6B', '#D4A373', '#FFFFFF'];
  for (const color of colors) {
    assert.ok(contrast(color, Utils.getContrastText(color)) >= 4.5, color);
  }
});

test('compressImage rifiuta SVG e ridimensiona il lato maggiore', async () => {
  class FakeImage {
    set src(value) {
      this.naturalWidth = 2400;
      this.naturalHeight = 1200;
      queueMicrotask(() => this.onload());
    }
  }

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillRect() {},
      drawImage() {}
    }),
    toDataURL: () => 'data:image/jpeg;base64,AAAA'
  };

  const { Utils } = loadAppScripts(['js/utils.js'], {
    Image: FakeImage,
    document: { createElement: () => canvas },
    URL: {
      createObjectURL: () => 'blob:test',
      revokeObjectURL() {}
    }
  });

  await assert.rejects(
    Utils.compressImage(new Blob(['<svg/>'], { type: 'image/svg+xml' })),
    /Formato non supportato/
  );
  await Utils.compressImage(new Blob(['image'], { type: 'image/png' }), 1280);
  assert.equal(canvas.width, 1280);
  assert.equal(canvas.height, 640);
});

test('createImageThumbnail riduce le immagini e rifiuta dati arbitrari', async () => {
  let dimensions = [1600, 1200];
  class FakeImage {
    set src(value) {
      this.naturalWidth = dimensions[0];
      this.naturalHeight = dimensions[1];
      queueMicrotask(() => this.onload());
    }
  }

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillRect() {},
      drawImage() {}
    }),
    toDataURL: (type, quality) => `${type};quality=${quality}`
  };
  const { Utils } = loadAppScripts(['js/utils.js'], {
    Image: FakeImage,
    document: { createElement: () => canvas }
  });

  await assert.rejects(Utils.createImageThumbnail('javascript:alert(1)'), /non validi/);
  await assert.rejects(Utils.createImageThumbnail('data:image/png;base64,AAAA', 0), /Dimensione/);
  const result = await Utils.createImageThumbnail('data:image/png;base64,AAAA', 360);
  assert.equal(canvas.width, 360);
  assert.equal(canvas.height, 270);
  assert.equal(result, 'image/jpeg;quality=0.72');

  dimensions = [10000, 5000];
  await assert.rejects(
    Utils.createImageThumbnail('data:image/png;base64,AAAA', 360),
    /Risoluzione/
  );
});
