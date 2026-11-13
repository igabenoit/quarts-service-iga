import JSZip from 'jszip';
import {get} from '@vercel/blob';
import {deflateSync} from 'node:zlib';
import {totals} from './public/numeraire-calcul.js';

async function loadCashTemplate(locker) {
 const path = 'numeraire/casier-' + locker + '.xlsx';
 if (process.env.VERCEL_ENV === 'production' || process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
  const result = await get(path, {access: 'private'});
  if (result?.statusCode !== 200) throw Error('Modèle de numéraire indisponible pour le casier ' + locker);
  return Buffer.from(await new Response(result.stream).arrayBuffer());
 }
 const encoded = process.env['CASH_TEMPLATE_' + locker];
 if (!encoded) throw Error('Modèle de numéraire absent pour le casier ' + locker);
 return Buffer.from(encoded, 'base64');
}

export async function orderWorkbooks(order) {
 return Promise.all(order.lockers.map(async (quantities, index) => {
  if (!quantities.some(Boolean)) return null;
  const locker = 24 + index;
  return orderXlsx(order, locker, await loadCashTemplate(locker));
 }));
}

const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function cell(sheet,address,value,formula){
 const re=new RegExp('<c\\b([^>]*\\br="'+address+'"[^>]*?)(?:/>|>[\\s\\S]*?</c>)');
 if(!re.test(sheet))throw Error('Missing template cell '+address);
 return sheet.replace(re,(original,attrs)=>'<c'+attrs.replace(/\s+t="[^"]*"/g,'').replace(/\/$/,'')+(typeof value==='number'?'>': ' t="inlineStr">')+(typeof value==='number'?((formula&&original.match(/<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/)?.[0])||'')+'<v>'+value+'</v>':'<is><t xml:space="preserve">'+xml(value)+'</t></is>')+'</c>');
}
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([n,t,data,c]);}
export function signaturePng(ink){
 const w=800,h=200,raw=Buffer.alloc((w*4+1)*h);
 function dot(x,y){for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const a=x+dx,b=y+dy;if(a<0||a>=w||b<0||b>=h)continue;const k=b*(w*4+1)+1+a*4;raw[k]=22;raw[k+1]=55;raw[k+2]=104;raw[k+3]=255;}}
 for(const line of ink)for(let i=1;i<line.length;i++){const [a,b]=line[i-1], [c,d]=line[i],steps=Math.max(1,Math.ceil(Math.hypot((c-a)*w,(d-b)*h)));for(let t=0;t<=steps;t++)dot(Math.round((a+(c-a)*t/steps)*(w-1)),Math.round((b+(d-b)*t/steps)*(h-1)));}
 const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
// Patch only entry cells, formula caches and the signature drawing. Keep the bank's
// original styles, logos, dimensions, merged cells and printer settings intact.
export async function orderXlsx(b,locker,template){
 const q=b.lockers[locker-24],{bills,total,error}=totals(q);if(error||!total)throw Error(error||'Empty locker');
 const zip=await JSZip.loadAsync(template);let sheet=await zip.file('xl/worksheets/sheet1.xml').async('string');
 sheet=cell(sheet,'K6','CAD');
 for(let i=0;i<5;i++){
  const r=9+i,n=i<2?q[i]:0,boxes=q[i+2];
  sheet=cell(sheet,'A'+r,n);sheet=cell(sheet,'F'+r,boxes);sheet=cell(sheet,'K'+r,0);sheet=cell(sheet,'O'+r,0);
  sheet=cell(sheet,'D'+r,n*[5,10,20,50,100][i],'A'+r+'*C'+r);
  sheet=cell(sheet,'I'+r,boxes*[100,250,500,1000,1000][i],'F'+r+'*H'+r);
  sheet=cell(sheet,'N'+r,0,'K'+r+'*M'+r);sheet=cell(sheet,'R'+r,0,'O'+r+'*Q'+r);
 }
 for(const [a,v,f] of [['C14',bills,'SUM(D9:D13)'],['H14',total-bills,'SUM(I9:I13)'],['M14',0,'SUM(N9:N13)'],['Q14',0,'SUM(R9:R13)'],[locker===24?'I17':'I16',total,'SUM(C14,H14,M14,Q14)']])sheet=cell(sheet,a,v,f);
 const r=locker===24?22:21;
 sheet=cell(sheet,'A'+r,b.date);sheet=cell(sheet,'E'+r,b.time);sheet=cell(sheet,'I'+r,locker);sheet=cell(sheet,'A'+(r+2),b.name.trim());
 sheet=cell(sheet,'A'+(r+5),b.notes.trim());sheet=cell(sheet,'A'+(r+7),'');
 zip.file('xl/worksheets/sheet1.xml',sheet);
 // Both original forms place the courier signature in image2, inside the print area.
 zip.file('xl/media/image2.png',signaturePng(b.ink));
 zip.remove('xl/calcChain.xml');
 for(const [path,re] of [['xl/_rels/workbook.xml.rels',/<Relationship\b[^>]*\bType="[^"]*\/calcChain"[^>]*\/>/g],['[Content_Types].xml',/<Override\b[^>]*PartName="\/xl\/calcChain.xml"[^>]*\/>/g]]){
  zip.file(path,(await zip.file(path).async('string')).replace(re,''));
 }
 const wb='xl/workbook.xml';zip.file(wb,(await zip.file(wb).async('string')).replace(/<calcPr\b[^>]*\/>/,'<calcPr calcId="0" fullCalcOnLoad="1"/>'));
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
