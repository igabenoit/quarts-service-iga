import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Keep the JSON contract used by both current and already-open manager pages.
// Vercel permits streaming responses above its buffered response limit.
export async function sendDepartmentPhoto(res, state, dataUrl) {
  res.set('Cache-Control','private, no-store');
  const photo = {...state,dataUrl};
  if (dataUrl.length < 3 * 1024 * 1024) return res.json(photo);

  const bytes = Buffer.from(JSON.stringify(photo));
  const chunkSize = 64 * 1024;
  function* chunks() {
    for (let offset=0; offset<bytes.length; offset+=chunkSize) {
      yield bytes.subarray(offset,offset+chunkSize);
    }
  }
  res.set('Content-Type','application/json; charset=utf-8');
  res.flushHeaders();
  try {
    await pipeline(Readable.from(chunks(),{objectMode:false}),res);
  } catch (error) {
    if (!res.destroyed) throw error;
  }
}
