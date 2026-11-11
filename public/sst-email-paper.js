let libraries;
function load(url) {
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.onload=resolve;
  script.onerror=()=>{script.remove();reject(Error('Impossible de charger le générateur PDF.'));};
  script.src=url;
  document.head.append(script);
 });
}
let preparing=false;
export async function emailPaper(title,source=document.getElementById('sstPrint')){
 if(preparing)return;
 preparing=true;
 const host=source.ownerDocument.createElement('div');
 try{
  libraries??=Promise.all([window.html2canvas||load('/vendor/html2canvas.js'),window.jspdf||load('/vendor/jspdf.js')]).catch(e=>{libraries=null;throw e;});
  host.style.cssText='position:absolute;left:-12000px;top:0;background:white;color:black;width:800px;padding:20px;box-sizing:border-box';
  for(const child of source.children)host.append(child.cloneNode(true));
  source.ownerDocument.body.append(host);
  await libraries;
  await source.ownerDocument.fonts.ready;
  const sheets=host.querySelectorAll('.sv-document > .sv-sheet');
  const pdf=new window.jspdf.jsPDF({unit:'pt',format:sheets.length?'legal':'letter',compress:true});
  if(sheets.length){
   for(const [index,sheet] of Array.from(sheets).entries()){
    const canvas=await window.html2canvas(sheet,{scale:2,backgroundColor:'#fff',logging:false});
    if(index)pdf.addPage();
    const ratio=Math.min(540/canvas.width,943/canvas.height);
    pdf.addImage(canvas.toDataURL('image/png'),'PNG',36,32,canvas.width*ratio,canvas.height*ratio,undefined,'FAST');
    canvas.width=canvas.height=0;
   }
  }else{
  const width=Math.max(800,host.scrollWidth);
  const height=Math.ceil(host.getBoundingClientRect().height);
  const pageHeight=Math.floor(width*744/564);
  if(!height)throw Error('Le document est vide.');
  for(let y=0;y<height;y+=pageHeight){
   const canvas=await window.html2canvas(host,{width,height:Math.min(pageHeight,height-y),y,scale:1.5,backgroundColor:'#fff',logging:false});
   if(y)pdf.addPage();
   pdf.addImage(canvas.toDataURL('image/jpeg',0.87),'JPEG',24,24,564,564*canvas.height/canvas.width);
   canvas.width=canvas.height=0;
  }
  }
  const blob=pdf.output('blob');
  if(blob.size>12*1024*1024)throw Error('Le PDF dépasse la limite de 12 Mo.');
  document.dispatchEvent(new CustomEvent('sst-email-pdf',{detail:{name:title.replace(/[\\/:*?"<>|]/g,' ').slice(0,140)+'.pdf',blob}}));
 }catch(error){alert('Préparation de la pièce jointe impossible. '+error.message);}
 finally{host.remove();preparing=false;}
}
