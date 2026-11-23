import PDFLib from './tuac/pdf-lib.min.cjs';

export function letterDuplexPreferences(pdf){
 const prefs=pdf.catalog.getOrCreateViewerPreferences();
 prefs.setDuplex(PDFLib.Duplex.DuplexFlipLongEdge);
 prefs.setPrintScaling(PDFLib.PrintScaling.None);
 prefs.setPickTrayByPDFSize(true);
 delete pdf.context.trailerInfo.Info;
}

// Printing preferences are advisory: Chrome and the selected printer still
// control duplex. Keep the archived document intact and prepare a read-only copy.
export async function letterDuplexCopy(bytes){
 const pdf=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
 if(pdf.getPageCount()<1||pdf.getPageCount()>2||pdf.getPages().some(p=>p.getWidth()!==612||p.getHeight()!==792))
  throw Error('Ce document ne tient pas sur une feuille lettre recto verso. L’original reste disponible.');
 letterDuplexPreferences(pdf);
 return Buffer.from(await pdf.save());
}
