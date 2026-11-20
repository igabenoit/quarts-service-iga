import {sendPrivateBytes} from './private-response.js';

// Keep the JSON contract used by both current and already-open manager pages.
// Vercel permits streaming responses above its buffered response limit.
export async function sendDepartmentPhoto(res, state, dataUrl) {
  res.set('Cache-Control','private, no-store');
  const photo = {...state,dataUrl};
  if (dataUrl.length < 3 * 1024 * 1024) return res.json(photo);

  res.set('Content-Type','application/json; charset=utf-8');
  return sendPrivateBytes(res,Buffer.from(JSON.stringify(photo)));
}
