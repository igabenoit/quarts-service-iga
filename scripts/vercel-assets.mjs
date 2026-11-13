import {readFileSync} from 'node:fs';

// Vercel publishes these source files as static assets before the Express install step.
const bundles = {
  'docx-preview.js': 'docx-preview/dist/docx-preview.min.js',
  'jszip.js': 'jszip/dist/jszip.min.js',
  'html2canvas.js': 'html2canvas/dist/html2canvas.min.js',
  'jspdf.js': 'jspdf/dist/jspdf.umd.min.js',
  'simplewebauthn.js': '@simplewebauthn/browser/dist/bundle/index.umd.min.js'
};

for (const [name, source] of Object.entries(bundles)) {
  const shipped = readFileSync(new URL('../public/vendor/' + name, import.meta.url));
  const installed = readFileSync(new URL('../node_modules/' + source, import.meta.url));
  if (!shipped.equals(installed)) {
    throw new Error('Mettre à jour public/vendor/' + name + ' depuis node_modules/' + source);
  }
}
console.log('Les cinq scripts navigateur correspondent aux dépendances installées.');
