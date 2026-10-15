// Render the existing schedule on fixed legal pages, without browser headers.
let libraries;
function script(src){return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=()=>{el.remove();reject(Error('Chargement du PDF impossible. Vérifiez la connexion et réessayez.'));};document.head.append(el);});}
async function loadLibraries(){
  if(!libraries)libraries=Promise.all([window.html2canvas?null:script('/vendor/html2canvas.js'),window.jspdf?null:script('/vendor/jspdf.js')]).catch(error=>{libraries=null;throw error;});
  await libraries;
}
export function pageImagePlacement(width,height){
  if(!(width>0&&height>0))throw Error('La feuille à imprimer est vide.');
  const scale=Math.min(612/width,1008/height);
  return {x:(612-width*scale)/2,y:(1008-height*scale)/2,width:width*scale,height:height*scale};
}
export function sheetOverflowMessage(sheet){
  const bounds=sheet.getBoundingClientRect();
  if(!(bounds.width>0&&bounds.height>0))return 'Affichez la feuille imprimable avant de préparer le PDF.';
  const safeBottom=bounds.bottom-parseFloat(getComputedStyle(sheet).paddingBottom);
  const notes=sheet.querySelector('.sheet-notes');
  if(sheet.scrollHeight>sheet.clientHeight+2||notes.getBoundingClientRect().bottom>safeBottom+2||notes.querySelector('p').getBoundingClientRect().bottom>safeBottom+2)return 'Le contenu dépasse la page légale. Raccourcissez les notes ou précisions avant de préparer le PDF. Aucun employé ne sera coupé.';
  const overflow=[...sheet.querySelectorAll('.sheet-work,.sheet-person-label,.sheet-day-detail span')].find(el=>el.scrollHeight>el.clientHeight+2||el.scrollWidth>el.clientWidth+2);
  if(overflow){const label=overflow.closest?.('.sheet-person')?.querySelector('.sheet-person-label'),name=label?.childNodes?.[0]?.textContent?.trim();return `Un texte dépasse une case${name?' pour « '+name+' »':''}. Raccourcissez les titres, précisions ou notes avant de préparer le PDF. Aucun employé ne sera coupé.`;}
  return '';
}
export async function schedulePDF(sheet,{label}={}){
  return schedulePagesPDF([sheet],{label});
}
export async function schedulePagesPDF(sheets,{label,previewSelector='#printPreview .department-sheet'}={}){
  if(!sheets.length)throw Error('Aucune feuille à imprimer.');
  await loadLibraries();await document.fonts.ready;
  await Promise.all(sheets.flatMap(sheet=>[...sheet.querySelectorAll('img')]).map(img=>img.decode()));
  for(const sheet of sheets){const overflow=sheetOverflowMessage(sheet);if(overflow)throw Error(overflow);}
  const pdf=new window.jspdf.jsPDF({orientation:'portrait',unit:'pt',format:'legal',compress:true});
  for(const [index,sheet] of sheets.entries()){
    const canvas=await window.html2canvas(sheet,{scale:3,backgroundColor:'#ffffff',logging:false,useCORS:false,
    width:Math.ceil(sheet.getBoundingClientRect().width),height:Math.ceil(sheet.getBoundingClientRect().height),
    onclone(doc){const copy=doc.querySelectorAll(previewSelector)[index];if(label)copy.querySelector('.sheet-header p').textContent=label;copy.style.boxShadow='none';copy.style.margin='0';const preview=copy.parentElement;preview.style.overflow='visible';preview.style.padding='0';preview.style.background='#ffffff';}
  });
    if(index)pdf.addPage('legal','portrait');
    const box=pageImagePlacement(canvas.width,canvas.height);
    pdf.addImage(canvas.toDataURL('image/png'),'PNG',box.x,box.y,box.width,box.height,undefined,'FAST');
  }
  return pdf.output('blob');
}
