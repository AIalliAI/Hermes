/// <reference types="vite/client" />

// Build flavor baked in by vite.config.ts `define`. 'full' is the standard
// desktop app; 'remote' is the standalone "Hermes Remote" client.
declare const __HERMES_FLAVOR__: 'full' | 'remote'
