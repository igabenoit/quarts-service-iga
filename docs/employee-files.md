# Dossiers d’employés

## Entrées

- `/dossiers-employes?vue=employe` : session employé existante, dossier personnel.
- `/dossiers-employes?vue=gerant` : compte gérant existant, départements autorisés.
- `/dossiers-employes?vue=direction` : administration ou responsabilités RH attribuées.
- `/dossiers-employes?vue=sst` : administration ou responsabilité SST attribuée.
- `/dossiers-employes#politique` : politique publique et coordonnées professionnelles.

Changer l’URL ne donne aucun droit supplémentaire. L’administration attribue les responsabilités nominatives dans Accès. Les comptes RH/SST reçoivent uniquement les catégories et départements explicitement autorisés. La création des modèles, la politique, l’EFVP et les incidents sont réservés à l’administration. Les gérants ne voient que le statut des pièces RH réservées.

## Identité et originaux

Le module lit la liste partagée du SST (`sstDirectory`), les départements et les liens explicites de `schedule_store_people`. Le code de six chiffres a été confirmé comme matricule de paie; c’est aussi un secret de connexion, jamais retourné dans la liste ni les rapports CSV. Les matricules absents, ambigus ou en double sont signalés; aucune fusion par nom et aucune adresse déduite. Le rapprochement CSV est un aperçu sans mutation du personnel.

Une attribution conserve la version du modèle. Les brouillons sont versionnés, les originaux et événements sont append-only. Une correction ouvre une nouvelle fiche ou relie une nouvelle pièce avec motif; elle ne remplace jamais un original. Un PDF confirmé ou une présence ne valide pas une compétence pratique. Les formations demeurent dans le registre SST existant.

Les nouvelles pièces SST du coffre sont projetées en lecture dans le SST sans copie de leurs octets. Une pièce SST ancienne peut être reliée explicitement au dossier; son original reste dans son stockage existant sur Render. Aucun dossier d’incident médical n’est importé automatiquement.

## Coffre séparé et activation

Sans configuration valide, le nouveau portail consulte le personnel mais refuse les nouvelles saisies et les dépôts. Il ne se replie jamais sur la base Render. Une erreur de schéma du coffre ne doit pas arrêter le SST.

Une fois la région et les identifiants configurés, le serveur vérifie la connexion TLS et le paramètre de session avec une seule requête de diagnostic sans données personnelles. Tant que la revue n’est pas validée, il ferme immédiatement la connexion, ne crée aucune table et ne donne aucun accès en écriture. Le bandeau distingue une connexion vérifiée d’un problème d’authentification ou de certificat, sans afficher de secret.

Configurer uniquement côté serveur, jamais dans le navigateur ou le dépôt :

- `EMPLOYEE_FILES_DATABASE_URL` : URL PostgreSQL du coffre séparé.
- `EMPLOYEE_FILES_DATABASE_PASSWORD` : mot de passe séparé facultatif, saisi directement dans les secrets du serveur; il est encodé pour la connexion sans apparaître dans l’URL de configuration.
- `EMPLOYEE_FILES_REGION=ca-central-1` : après vérification réelle du projet Canada Central.
- `EMPLOYEE_FILES_HOSTING_REVIEWED=yes` : seulement après revue et autorisation du responsable portant sur l’hébergement et les flux hors Québec; ce drapeau n’est pas une attestation juridique.
- `EMPLOYEE_FILES_CA_PEM` : certificat d’autorité si requis par le fournisseur. La vérification TLS reste obligatoire.

Utiliser une connexion directe PostgreSQL ou un pooler en mode session qui conserve les paramètres de session. Le module utilise le schéma `employee_files_private`, retire les accès PUBLIC/anon/authenticated et n’utilise pas la Data API. Désactiver la Data API et l’exposition automatique des tables dans le projet Supabase; ne jamais exposer ce schéma. Le compte SQL doit être limité au coffre, sans accès à d’autres applications. L’initialisation exige la propriété du schéma, des tables et des déclencheurs. Ne jamais stocker le mot de passe dans les journaux ni la conversation.

Les nouveaux dossiers restent traités par le serveur Render aux États-Unis : une base canadienne ne supprime pas les obligations d’évaluation des communications hors Québec. Vérifier les ententes, les sous-traitants, le soutien, les journaux et les sauvegardes, puis tester une restauration. Ne pas activer la collecte sur la seule base d’un nom de région.

## Limites de la première version

- Invitations et courriels réels désactivés côté serveur.
- Collecte bancaire et fiscale désactivée côté serveur; les modèles médicaux génériques demeurent non publiables. Exception ciblée : la fiche facultative « Informations en cas d’urgence » dans le parcours d’accueil et sur place (contacts, allergies et soins rapides), réservée au coffre des dossiers employés et enregistrée en catégorie `medical`.
- Formulaires d’accueil : TUAC 500, régime de retraite, fiche d’urgence, code d’éthique et **Programme d’accueil général SST 2026**. Le PDF vierge SST (3 pages, champs remplissables) est accessible dans l’onglet Formulaires; les copies signées sont conservées dans le coffre, non sur Google Drive. L’ancienne annexe SST 11.1 reste disponible pour consultation des dossiers historiques, mais n’est plus présélectionnée pour une nouvelle embauche.
- Lorsqu’un employé complète le programme SST à distance, il confirme seulement les six sujets expliqués et signe sa réception. Le serveur supprime toute donnée de supervision, de formation pratique et d’autorisation de machine qui aurait été envoyée par un lien d’employé. Sur place, le responsable peut saisir les risques, les tâches observées et signer distinctement. Les autorisations doivent demeurer fondées sur une véritable démonstration et une observation : une attestation signée n’équivaut pas à une formation réalisée.
- Les renseignements médicaux ne sont consultables que par leur employé, la direction administratrice ou une responsabilité médicale explicitement accordée et limitée au département. Les gérants et RH sans autorisation médicale ne peuvent pas ouvrir le PDF; leur tableau de suivi indique uniquement son achèvement.
- L’employé peut choisir « Je préfère ne pas répondre » pour chacune des questions de santé. Une réponse positive exige d’identifier la condition ou l’allergie; des détails complémentaires sont conservés dans l’annexe du PDF signé. La fiche n’autorise pas l’administration de médicaments.
- Authentification existante réutilisée; aucun SSO commun aux employés n’existe actuellement. Renforcement à approuver avant ouverture des données sensibles.
- Les modèles et la politique doivent être approuvés par la direction. L’acquittement de la politique publiée est personnel, explicite, non précoché; ce n’est pas un consentement universel.
- La signature est une confirmation personnelle horodatée sous la session existante; aucune signature qualifiée ou certification juridique n’est revendiquée.
- L’export de dossiers est un index JSON autorisé; les originaux se téléchargent individuellement. La sauvegarde SST inclut les originaux SST partagés.
- L’EFVP et le registre d’incidents sont privés et versionnés. Les durées de destruction restent à approuver; aucune purge automatique.

## Vérification

`node --test test/employee-files.test.js test/equipment-training.test.js test/sst.test.js`

Les essais démarrent l’application réelle dans deux bases PGlite distinctes, sans clés externes, avec des employés et comptes fictifs. Ils couvrent les scopes, IDOR, exports, pièces, conflits, originaux, corrections, révocation, politique, registre et redémarrage; ils vérifient aussi l’absence de repli vers Render et le maintien du SST si l’initialisation du coffre échoue. Ils ne constituent pas un audit indépendant ni une vérification des réglages du fournisseur réel.
