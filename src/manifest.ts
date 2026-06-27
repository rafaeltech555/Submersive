import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Submersive',
  version: '0.0.1',
  description: 'YouTube 沉浸式雙語字幕',
  permissions: ['storage'],
  host_permissions: [
    'https://*.youtube.com/*',
    'https://*.netflix.com/*',
    'https://api-free.deepl.com/*',
    'https://api.cognitive.microsofttranslator.com/*',
    'http://localhost:*/*',
    'http://127.0.0.1:*/*',
  ],
  background: { service_worker: 'src/background/background.ts', type: 'module' },
  content_scripts: [
    {
      matches: ['https://*.youtube.com/*'],
      js: ['src/inject/hook.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    },
    {
      matches: ['https://*.youtube.com/*'],
      js: ['src/content/content.ts'],
      run_at: 'document_start',
      world: 'ISOLATED',
    },
    {
      matches: ['https://*.netflix.com/*'],
      js: ['src/inject/netflix-hook.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    },
    {
      matches: ['https://*.netflix.com/*'],
      js: ['src/content/netflix-content.ts'],
      run_at: 'document_idle',
      world: 'ISOLATED',
    },
  ],
  options_page: 'src/options/options.html',
  action: { default_popup: 'src/popup/popup.html' },
})
