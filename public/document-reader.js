import {mountEditor} from '/prevention-editor.js';
let libraryPromise;
const script=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(Error('Lecteur indisponible. Actualisez la page.'));document.head.append(s);});
const libraries=()=>libraryPromise??=(async()=>{await script('/vendor/jszip.js');await script('/vendor/docx-preview.js');})();
export async function displayDocument(host,doc){
 host.replaceChildren();const status=document.createElement('p');status.textContent='Chargement du document…';host.append(status);
 try{
  const response=await fetch('/api/sst/documents/'+doc.id,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Le document ne peut pas être ouvert. Vérifiez votre connexion administrateur.');const data=await response.arrayBuffer();if(!host.isConnected)return;
  if(/\.docx$/i.test(doc.name)){
   await libraries();const zip=await window.JSZip.loadAsync(data);
   // Rendering stays local to the browser. Remove external relationships and HTML chunks.
   for(const [path,file] of Object.entries(zip.files))if(path.endsWith('.rels')){const xml=new DOMParser().parseFromString(await file.async('string'),'application/xml');for(const rel of [...xml.getElementsByTagName('Relationship')])if(rel.getAttribute('TargetMode')==='External')rel.remove();zip.file(path,new XMLSerializer().serializeToString(xml));}
   const sanitized=await zip.generateAsync({type:'arraybuffer'});if(!host.isConnected)return;
   host.replaceChildren();const frame=document.createElement('iframe');frame.title='Programme de prévention — document original remplissable';frame.setAttribute('sandbox','allow-same-origin allow-modals');frame.className='pp-original-frame';
   const loaded=new Promise(resolve=>{frame.onload=resolve;});frame.src='/sst-document-frame';host.append(frame);await loaded;
   if(!host.isConnected)return;const body=frame.contentDocument.body;
   await window.docx.renderAsync(sanitized,body,frame.contentDocument.head,{className:'docx',inWrapper:true,breakPages:true,ignoreLastRenderedPageBreak:false,renderAltChunks:false,useBase64URL:true});
   await mountEditor(host,doc,body,frame);return;
  }else if(doc.mime==='application/pdf'||/\.pdf$/i.test(doc.name)){
   const lib=await import('/vendor/pdfjs/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';const task=lib.getDocument({data,isEvalSupported:false});const pdf=await task.promise;if(!host.isConnected){await task.destroy();return;}
   host.replaceChildren();const bar=document.createElement('div'),prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span'),canvas=document.createElement('canvas');bar.className='row-actions';prev.className=next.className='quiet';prev.textContent='← Page précédente';next.textContent='Page suivante →';bar.append(prev,label,next);canvas.style.cssText='display:block;max-width:100%;height:auto;margin:16px auto;background:white';host.append(bar,canvas);let page=1,busy=false;
   const draw=async()=>{if(busy)return;busy=true;prev.disabled=next.disabled=true;try{const p=await pdf.getPage(page),v=p.getViewport({scale:1.5});canvas.width=v.width;canvas.height=v.height;await p.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;canvas.setAttribute('aria-label','Page '+page+' du programme');label.textContent='Page '+page+' / '+pdf.numPages;}finally{busy=false;prev.disabled=page===1;next.disabled=page===pdf.numPages;}};prev.onclick=()=>{page--;draw();};next.onclick=()=>{page++;draw();};await draw();
  }else if(doc.mime.startsWith('image/')){const img=document.createElement('img');img.src=URL.createObjectURL(new Blob([data],{type:doc.mime}));img.alt=doc.name;img.style.maxWidth='100%';host.replaceChildren(img);img.onload=()=>URL.revokeObjectURL(img.src);}
  else throw Error('Ce format ne peut pas être affiché ici. Ajoutez une copie PDF pour la lecture intégrée.');
 }catch(e){if(host.isConnected)host.textContent=e.message;}
}

