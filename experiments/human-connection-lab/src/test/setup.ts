import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Each test starts from an empty browser: no saved world, no rendered screen.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.location.hash = '';
});
