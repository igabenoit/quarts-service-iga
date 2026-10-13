import {fileURLToPath} from 'node:url';
export function installPdfAssets(app){
  // Expose only pinned browser bundles, never the whole dependency directory.
  for(const [route,path] of [['html2canvas','html2canvas/dist/html2canvas.min.js'],['jspdf','jspdf/dist/jspdf.umd.min.js']]){
    const file=fileURLToPath(new URL('./node_modules/'+path,import.meta.url));
    app.get('/vendor/'+route+'.js',(_req,res)=>res.sendFile(file));
  }
}
