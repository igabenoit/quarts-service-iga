// Render the existing schedule only. A PDF has one fixed legal page and no browser headers.
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
export async function schedulePDF(sheet,{label}={}){
  await loadLibraries();await document.fonts.ready;
  await Promise.all([...sheet.querySelectorAll('img')].map(img=>img.decode()));
  const canvas=await window.html2canvas(sheet,{scale:3,backgroundColor:'#ffffff',logging:false,useCORS:false,
    width:Math.ceil(sheet.getBoundingClientRect().width),height:Math.ceil(sheet.getBoundingClientRect().height),
    onclone(doc){const copy=doc.querySelector('#printPreview .department-sheet');if(label)copy.querySelector('.sheet-header p').textContent=label;copy.style.boxShadow='none';copy.style.margin='0';const preview=copy.parentElement;preview.style.overflow='visible';preview.style.padding='0';preview.style.background='#ffffff';}
  });
  const pdf=new window.jspdf.jsPDF({orientation:'portrait',unit:'pt',format:'legal',compress:true});
  const box=pageImagePlacement(canvas.width,canvas.height);
  pdf.addImage(canvas.toDataURL('image/png'),'PNG',box.x,box.y,box.width,box.height,undefined,'FAST');
  return pdf.output('blob');
}
