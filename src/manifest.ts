import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'dualsub',
  version: '0.0.1',
  description: 'YouTube 沉浸式雙語字幕',
  permissions: ['storage'],
  host_permissions: [
    'https://*.youtube.com/*',
    'https://api-free.deepl.com/*',
    'http://localhost/*',
  ],
  background: { service_worker: 'src/background/background.ts', type: 'module' },
  content_scripts: [
    {
      matches: ['https://*.youtube.com/*'],
      js: ['src/content/content.ts'],
      run_at: 'document_start',
    },
  ],
  web_accessible_resources: [
    { resources: ['src/inject/hook.ts'], matches: ['https://*.youtube.com/*'] },
  ],
  options_page: 'src/options/options.html',
  action: { default_popup: 'src/popup/popup.html' },
})
