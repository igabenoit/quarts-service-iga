export const PHOTO_PART_BYTES = 2 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

async function send(path, method, body, type) {
  // The server accepts an identical retry, including completion after a lost response.
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(path, {
        method, body, headers: type ? {'Content-Type': type} : {}, credentials: 'same-origin'
      });
    } catch (error) {
      if (attempt === 0) continue;
      throw error;
    }
    if (response.status >= 500 && attempt === 0) continue;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(result.error || 'L’envoi de la photo a échoué. Réessayez.');
    return result;
  }
}

export async function depositPhoto(file, departmentId, weekStart) {
  if (file.size > MAX_PHOTO_BYTES) throw Error('Choisissez une photo de 8 Mo ou moins.');
  const path = '/api/departments/' + departmentId + '/photo-uploads/' + crypto.randomUUID();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const sha256 = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  const metadata = {weekStart, name: file.name, mime: file.type, size: file.size, sha256};
  await send(path, 'POST', JSON.stringify(metadata), 'application/json');
  try {
    for (let offset = 0; offset < file.size; offset += PHOTO_PART_BYTES) {
      const part = file.slice(offset, offset + PHOTO_PART_BYTES);
      await send(path + '/parts/' + offset, 'PUT', part, 'application/octet-stream');
    }
    return await send(path + '/complete', 'POST');
  } catch (error) {
    await fetch(path, {method:'DELETE', credentials:'same-origin'}).catch(() => {});
    throw error;
  }
}
