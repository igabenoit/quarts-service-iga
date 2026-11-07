import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export function installPdfAssets(app){
  const require=createRequire(import.meta.url),docx=require.resolve('docx-preview'),zip=require.resolve('jszip',{paths:[dirname(docx)]});
  app.get('/vendor/docx-preview.js',(_req,res)=>res.sendFile(docx));
  app.get('/vendor/jszip.js',(_req,res)=>res.sendFile(dirname(dirname(zip))+'/dist/jszip.min.js'));
  // Expose only pinned browser bundles, never the whole dependency directory.
  for(const [route,path] of [['html2canvas','html2canvas/dist/html2canvas.min.js'],['jspdf','jspdf/dist/jspdf.umd.min.js']]){
    const file=fileURLToPath(new URL('./node_modules/'+path,import.meta.url));
    app.get('/vendor/'+route+'.js',(_req,res)=>res.sendFile(file));
  }
}

