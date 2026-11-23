// Open the already authorized PDF bytes in the browser's native PDF viewer.
// Direct navigation to the private endpoint can be blocked by PDF extensions
// or response sandbox handling. Keep the endpoint's protections unchanged.
export async function pdfBytes(response){
 if(!response.ok||!response.headers.get('content-type')?.startsWith('application/pdf'))throw Error('Le PDF à imprimer est indisponible. Rouvre le document depuis le dossier employé.');
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length<5||String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')throw Error('Le document reçu n’est pas un PDF.');
 return bytes;
}

export function pdfPrintUrl(bytes){
 // Create the Blob before handing bytes to PDF.js, which may transfer/detach
 // their buffer when its worker starts. Preserve page size and PDF preferences.
 return URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
}

export function attachPdfPrintLink(button,url,label,filename){
 const open=document.createElement('a');open.id=button.id;open.href=url;open.target='_blank';open.rel='noopener';open.textContent=label;
 button.replaceWith(open);
 const download=document.createElement('a');download.href=url;download.download=filename;download.textContent='Télécharger le PDF à imprimer';
 open.after(download);
 return open;
}
