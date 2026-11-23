import PDFLib from './tuac/pdf-lib.min.cjs';

const key=PDFLib.PDFName.of('QuartTuacPrintLayout');
const version=PDFLib.PDFName.of('Letter20261123B');
export const tuacPrintLayout=pdf=>pdf.catalog.get(key)?.toString();
export const currentTuacPrintLayout=version.toString();

export function calibrateTuacPrint(pdf){
 // Measured against the three preprinted slips in the Xerox scan of 2026-11-23.
 // The former native printout crossed the rules by 2-4 pt and started outside
 // the left edges. Move the entire overlay, including all signature strokes.
 // Keep the exact physical size; never fit, rasterize or redraw signed content.
 pdf.getPage(0).translateContent(4,7.5);
 pdf.catalog.set(key,version);
 const prefs=pdf.catalog.getOrCreateViewerPreferences();
 prefs.setPrintScaling(PDFLib.PrintScaling.None);
 prefs.setDuplex(PDFLib.Duplex.Simplex);
 prefs.setPickTrayByPDFSize(true);
}
