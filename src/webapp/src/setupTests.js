import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Node's global localStorage is disabled without a storage file and shadows
// the jsdom storage when the test globals are populated. Provide the browser
// API for the components that persist per-device settings.
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      const value = store.get(String(key));
      return value === undefined ? null : value;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(String(key));
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
  },
});

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});
