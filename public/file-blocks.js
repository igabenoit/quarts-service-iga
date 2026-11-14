export const PART_BYTES = 2 * 1024 * 1024;

export async function sendBlocks(file, url, headers, metadata) {
  url = new URL(url, location.origin);
  async function send(method, suffix, body, type) {
    const target = new URL(url);
    target.pathname += suffix;
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetch(target, {method, body, credentials:'same-origin',
          headers: type ? {...headers, 'Content-Type':type} : headers});
      } catch (error) {
        if (!attempt) continue;
        throw error;
      }
      if (response.status >= 500 && !attempt) continue;
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(Error(result.error || 'Le transfert a échoué. Réessayez.'),{status:response.status});
      return result;
    }
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const sha256 = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  try {
    await send('POST','',JSON.stringify({...metadata,size:file.size,sha256}),'application/json');
    for (let offset=0; offset<file.size; offset+=PART_BYTES) {
      await send('PUT','/parts/'+offset,file.slice(offset,offset+PART_BYTES),'application/octet-stream');
    }
    return await send('POST','/complete');
  } catch (error) {
    await send('DELETE','').catch(()=>{});
    throw error;
  }
}

export function depositDocument(file,originalUrl,header,limitMiB=12) {
  if (!file?.size || file.size>limitMiB*1024*1024) throw Error('Choisissez un fichier de '+limitMiB+' Mo ou moins.');
  const url=new URL(originalUrl,location.origin);
  url.pathname+='/uploads/'+crypto.randomUUID();
  return sendBlocks(file,url,{[header]:'1'},{name:file.name});
}
