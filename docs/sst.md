# Espace Santé et sécurité

Accessible à `/sst` depuis le menu administrateur de Quarts Service. Le serveur réserve toutes les API SST, les fichiers et les sauvegardes à la session d’administration existante. Les comptes individuels de gérants n’y ont pas accès dans cette première version.

## Utilisation

- Le répertoire lit les employés du service et des départements. Les liens existants permettent d’éviter les doublons, sans rapprocher des personnes uniquement par leur nom. Les fiches d’horaire ne sont pas modifiées. Les codes de connexion et dates de naissance ne sont pas transmis au module.
- Créer un dossier de formation, équipement, incident, rencontre, inspection, correctif ou document de référence. Les dossiers peuvent être reliés et associés à un employé et à un département.
- Joindre les documents originaux : PDF, JPG, PNG, WebP, Word, Excel ou PowerPoint, jusqu’à 12 Mo par fichier. Une empreinte SHA-256 identifie les octets conservés. Les fichiers sont stockés dans PostgreSQL, pas dans le système de fichiers temporaire de Render.
- Distinguer la date réelle de l’activité de la date de saisie, conservée automatiquement. Les modèles de préparation ne créent aucun dossier tant que l’utilisateur ne l’enregistre pas. Aucune formation, signature ou preuve historique n’est générée automatiquement.
- Imprimer une liste ou un dossier avec ses dossiers liés et l’index de ses pièces. Les originaux s’ouvrent séparément pour consultation et impression.
- Exporter une sauvegarde JSON contenant les dossiers, le répertoire, l’historique et les fichiers en base64. Conserver cet export dans un emplacement privé. Cette version ne propose pas d’import automatique de sauvegarde.

Les dossiers et fichiers s’archivent puis se restaurent. Les originaux ne sont pas remplacés. Les modifications de dossiers conservent leurs valeurs avant et après dans le journal. Une version obsolète est refusée pour éviter d’écraser une modification concurrente. Le journal constitue une trace applicative, pas une certification indépendante de conformité.

## Déploiement

L’espace de base ne nécessite aucune nouvelle variable d’environnement ni dépendance. `installSST` crée uniquement les tables `sst_records`, `sst_documents`, `sst_events` et leurs index au démarrage. La base et l’authentification de l’application sont réutilisées. Sans lot d’import, l’espace commence sans données SST : les exemples des tests restent dans leurs bases temporaires isolées.

## Vérification

```sh
npm run check
node --test --test-concurrency=1 test/sst.test.js test/manager-access.test.js test/department-schedules.test.js
PLAYWRIGHT_MODULE=/opt/codex/cua_node/lib/node_modules/playwright BROWSER_EXECUTABLE=/usr/bin/chromium node test/browser-sst.mjs
```

Les essais vérifient les accès administrateur/gérant/anonyme, le répertoire partagé, les versions concurrentes, l’archivage, les fichiers intacts, la sauvegarde complète et les parcours réels dans le navigateur, dont l’impression, le mobile et la fermeture de session.

## Réception documentaire confidentielle

Le bouton « Importer un lot » accepte un fichier JSON au format `iga-sst-intake-v1`, jusqu’à 16 Mo. Le fichier contient les notes de classement et les originaux en base64. Le navigateur présente les titres et le nombre de pièces avant l’envoi. Seule une session d’administration peut lancer l’import, par une requête de même origine avec en-tête dédié. Aucun document utilisateur n’est inclus dans le dépôt ou le code déployé.

L’import vérifie chaque empreinte et format de fichier, les liens et les départements avant de terminer une transaction unique. La table `sst_imports` mémorise l’identifiant et l’empreinte du lot : renvoyer le même fichier ne recrée aucun dossier et n’écrase pas les corrections ou archives faites ensuite. Une visite CNESST déjà préparée pour la même date est réutilisée sans modification. Les créations sont consignées dans le journal avec leur date de saisie réelle et un acteur d’import explicite. Le répertoire employé reste inchangé et aucune formation individuelle n’est produite par le lot.

Les fichiers de variantes sont conservés ensemble, sans suppression sur la base d’un texte similaire. Les incertitudes et les formulaires vierges sont signalés dans les dossiers. Le bilan du classement est accessible depuis la vue d’ensemble. La sauvegarde complète inclut aussi la provenance des imports. Un fichier de lot contient des renseignements privés : le transmettre directement par cette interface authentifiée et le conserver dans un emplacement privé.

Vérification supplémentaire : `node --test test/sst-intake.test.js` (originaux, liens, réexécution, conservation des modifications, réutilisation de la visite et annulation complète d’un lot invalide).
