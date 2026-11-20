import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Call after the route has authorized access and set its type and disposition.
// Flush before writing so the platform does not buffer the entire original.
export async function sendPrivateBytes(res,bytes) {
  res.set('Cache-Control','private, no-store');
  if (!Buffer.isBuffer(bytes)) bytes=Buffer.from(bytes);
  if (bytes.length<3*1024*1024) return res.send(bytes);
  function* chunks() {
    for (let offset=0;offset<bytes.length;offset+=65536) yield bytes.subarray(offset,offset+65536);
  }
  res.flushHeaders();
  try { await pipeline(Readable.from(chunks(),{objectMode:false}),res); }
  catch (error) { if (!res.destroyed) throw error; }
}
