import {trainingSchemaSQL,trainingPrivateSQL} from '../training-tracker.js';
// Existing Charcuterie references, verified in the source library on 2026-11-26.
const references=[
 ['Couteaux — utilisation et nettoyage','a5b5a2b5-7b7f-452f-9514-c812e9f9cd51'],
 ['Emballeuse manuelle — utilisation et nettoyage','56f63354-8ed2-46f1-96d5-69b54fc00bcf'],
 ['Râpe à fromage électrique — utilisation et nettoyage','41ac85ab-6198-462b-bbd5-9d2b64ec1c1f'],
 ['Trancheur automatique DEKO — utilisation, nettoyage et produit coincé','79f27e64-372d-4d0c-ada6-aa004b4b4d78'],
 ['Trancheur manuel Bizerba — utilisation et nettoyage','bfc43597-2e4e-4f2f-83c9-520b8b8d1644']
];
const items=references.map(([title,documentId],i)=>({id:`8dd1ead3-834b-4e41-a7c1-00000000000${i+1}`,title,documentId}));
console.log('SET search_path TO employee_files_private, public;\n'+trainingSchemaSQL+trainingPrivateSQL+`\nINSERT INTO training_lists(id,department_id,title,items) VALUES('8dd1ead3-834b-4e41-a7c1-000000000000',8,'Formations à l’embauche — Charcuterie','${JSON.stringify(items).replaceAll("'","''")}') ON CONFLICT(id) DO NOTHING;`);
