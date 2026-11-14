import {PART_BYTES,sendBlocks} from './file-blocks.js';
export const PHOTO_PART_BYTES=PART_BYTES;
export const MAX_PHOTO_BYTES=8*1024*1024;

export function depositPhoto(file, departmentId, weekStart) {
  if (file.size>MAX_PHOTO_BYTES) throw Error('Choisissez une photo de 8 Mo ou moins.');
  const path='/api/departments/'+departmentId+'/photo-uploads/'+crypto.randomUUID();
  return sendBlocks(file,path,{},{weekStart,name:file.name,mime:file.type});
}
