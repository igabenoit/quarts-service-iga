let dirty=false;
export function canLeave(){return !dirty||confirm('Des modifications ne sont pas enregistrées. Quitter sans enregistrer ?');}
export function clear(){dirty=false;}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
export async function mountEditor(host,doc,body,frame){
 clear();if(!document.getElementById('ppStyle')){const css=document.createElement('link');css.id='ppStyle';css.rel='stylesheet';css.href='/prevention-editor.css';document.head.append(css);}
 const response=await fetch('/api/sst/prevention/'+doc.id,{cache:'no-store'});if(!response.ok)throw Error('Reconnectez-vous pour compléter le programme.');const saved=await response.json();if(!host.isConnected)return;let version=saved.version;
 const style=frame.contentDocument.createElement('style');style.textContent=`body{margin:0;background:#e5e7e5}.docx-wrapper{padding:20px!important}section.docx{margin-bottom:20px!important}[contenteditable=plaintext-only]{outline:1px dashed #9faeaa;cursor:text;min-width:30px}[contenteditable=plaintext-only]:focus{outline:2px solid #21745a}[contenteditable=plaintext-only]:empty{display:inline-block;min-width:70px;min-height:1em}td p[contenteditable=plaintext-only]:empty{display:block;min-width:0} @media print{body{background:white;zoom:1!important}.docx-wrapper{padding:0!important;background:white!important}section.docx{box-shadow:none!important;margin:0!important;break-after:page}section.docx:last-child{break-after:auto}[contenteditable]{outline:none!important}@page{margin:0}}`;frame.contentDocument.head.append(style);
 // Keep the original Word DOM and all its page styles. Only designated blanks and highlighted runs become editable.
 // Word floating tables can exceed the text area after DOCX conversion. Scale each whole
 // table uniformly into that area, preserving column proportions, typography and cell layout.
 const fitTables=()=>{for(const table of body.querySelectorAll('article table')){if(table.parentElement.closest('table'))continue;const article=table.closest('article'),computed=frame.contentWindow.getComputedStyle(table);table.style.zoom='1';const width=table.offsetWidth+(parseFloat(computed.marginLeft)||0)+(parseFloat(computed.marginRight)||0);if(width>article.clientWidth)table.style.zoom=String((article.clientWidth-2)/width);}};
 fitTables();frame.contentDocument.fonts?.ready.then(fitTables);
 const candidates=[];for(const p of body.querySelectorAll('article p')){
  if(p.closest('header,footer')||p.querySelector('p,img,svg'))continue;
  if(!p.textContent.trim()&&p.closest('td')){candidates.push(p);continue;}
  for(const span of p.querySelectorAll('span')){if(span.querySelector('span'))continue;const text=span.textContent,background=span.style.backgroundColor;
   if(/Cliquez ou appuyez ici|Click or tap here/i.test(text)||background&&background!=='transparent'&&background!=='rgb(255, 255, 255)'||/^[☐☑□]$/.test(text.trim()))candidates.push(span);
  }
 }
 const fields=[];for(const [index,el] of candidates.entries()){
  const key='p'+(20000+index),placeholder=/Cliquez ou appuyez ici|Click or tap here/i.test(el.textContent);const original=el.textContent;
  if(Object.hasOwn(saved.values,key))el.textContent=saved.values[key];
  el.setAttribute('contenteditable','plaintext-only');el.setAttribute('role','textbox');el.setAttribute('aria-label',placeholder?'Champ à compléter':original.trim()||'Cellule à compléter');el.setAttribute('aria-multiline','true');
  if(placeholder)el.addEventListener('focus',()=>{if(el.textContent===original){el.textContent='';}}, {once:true});
  fields.push({key,el,initial:el.textContent});
 }
 const bar=document.createElement('div');bar.className='pp-toolbar';const save=document.createElement('button'),print=document.createElement('button'),zoom=document.createElement('select'),status=document.createElement('span');save.className='button primary';save.textContent='Enregistrer';print.className='quiet';print.textContent='Imprimer / PDF';zoom.setAttribute('aria-label','Zoom du document');for(const [value,label] of [['fit','Ajuster à la largeur'],['1','100 %'],['1.25','125 %'],['1.5','150 %']])zoom.append(new Option(label,value));status.setAttribute('role','status');status.textContent='Document original · '+fields.length+' zones remplissables';bar.append(save,print,zoom,status);host.prepend(bar);
 const fit=()=>{const page=body.querySelector('section.docx');if(page)body.style.zoom=zoom.value==='fit'?String(Math.min(1,(frame.clientWidth-24)/(Math.max(...[...body.querySelectorAll('section.docx')].map(p=>p.offsetWidth))+40))):zoom.value;};zoom.onchange=fit;fit();const resize=new ResizeObserver(()=>{if(host.isConnected)fit();else resize.disconnect();});resize.observe(host);
 const values=()=>({...saved.values,...Object.fromEntries(fields.filter(f=>f.el.textContent!==f.initial||Object.hasOwn(saved.values,f.key)).map(f=>[f.key,f.el.textContent]))});body.addEventListener('input',()=>{dirty=true;status.textContent='Modifications non enregistrées';});
 save.onclick=async()=>{save.disabled=true;const snapshot=values();try{const r=await fetch('/api/sst/prevention/'+doc.id,{method:'POST',headers:{'Content-Type':'application/json','X-SST-Request':'1'},body:JSON.stringify({version,values:snapshot})});const result=await r.json();if(!r.ok)throw Error(result.error||'Enregistrement impossible.');version=result.version;dirty=JSON.stringify(values())!==JSON.stringify(snapshot);saved.values=snapshot;status.textContent=dirty?'Modifications non enregistrées':'Programme enregistré';}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};
 print.onclick=()=>frame.contentWindow.print();
}

