import {employeeFilesStorage} from '../employee-files-storage.js';
import {installDocumentUploadSchema} from '../document-uploads.js';

// Run with the reviewed Canadian vault configuration during production preparation.
const vault=await employeeFilesStorage();
if (!vault.pool || vault.status.region!=='ca-central-1') throw Error('Coffre général canadien requis.');
try {
  const {rows:[context]}=await vault.pool.query('SELECT current_schema() AS schema');
  if(context.schema!=='employee_files_private') throw Error('Schéma du coffre inattendu.');
  await installDocumentUploadSchema(vault.pool);
} finally {await vault.pool.end();}
