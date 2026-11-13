import {copyFileSync, mkdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const publicVendor = fileURLToPath(new URL('../public/vendor/', import.meta.url));
const modules = fileURLToPath(new URL('../node_modules/', import.meta.url));
const docx = require.resolve('docx-preview');
const zip = require.resolve('jszip', {paths:[dirname(docx)]});
// Vercel must receive the passkey script in the source upload, before installation.
const passkeyBundle = join(modules, '@simplewebauthn/browser/dist/bundle/index.umd.min.js');
if (!readFileSync(join(publicVendor, 'simplewebauthn.js')).equals(readFileSync(passkeyBundle))) {
  throw new Error('Mettre à jour public/vendor/simplewebauthn.js depuis la version installée de @simplewebauthn/browser.');
}
const bundles = {
  'docx-preview.js': docx,
  'jszip.js': join(dirname(zip), '../dist/jszip.min.js'),
  'html2canvas.js': join(modules, 'html2canvas/dist/html2canvas.min.js'),
  'jspdf.js': join(modules, 'jspdf/dist/jspdf.umd.min.js')
};
mkdirSync(publicVendor, {recursive:true});
for (const [name, source] of Object.entries(bundles)) copyFileSync(source, join(publicVendor, name));
console.log('Bibliothèques navigateur préparées et bundle de connexion vérifié.');
