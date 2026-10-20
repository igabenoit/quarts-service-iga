# Discussion du Service

La page `/discussion` ajoute une discussion commune au portail employé. Le lien apparaît après vérification de l’appartenance au Service, avec le nombre de messages non lus. Les gestionnaires autorisés au Service et l’administration ouvrent `/discussion?mode=manager` depuis leur navigation.

Fonctions : messages texte (4 000 caractères), une photo JPEG/PNG/WebP par message (2 Mo maximum), historique paginé, actualisation toutes les 5 secondes lorsque la page est visible, compteur de non-lus dans le portail (15 secondes), et jusqu’à dix annonces épinglées par les gestionnaires. Les photos et messages sont conservés dans PostgreSQL. Aucun stockage sur le disque éphémère de Render.

L’identité de l’auteur est déterminée sur le serveur. Les employés doivent avoir une session personnelle valide et être actifs au Service (fiche Service ou appartenance explicite au département). Les dossiers liés sont ceux résolus par le portail existant. Les sessions familiales, les codes communs et les gestionnaires d’autres départements ne donnent pas accès à cette discussion. Les accès sont revérifiés pour chaque lecture, photo et écriture. L’administrateur utilisant le code partagé signe « Administration »; un compte personnel de gestionnaire signe sous son nom.

Les messages sont rendus comme du texte. Les écritures utilisent la protection d’origine existante, la limite d’envoi est de 20 messages par minute par identité, et une clé d’idempotence évite les doublons après une réponse réseau perdue. Les curseurs de lecture ne reculent pas; un message n’est marqué lu que lorsque la discussion est au bas, visible et au premier plan.

## Déploiement et validation

Les deux tables `schedule_service_messages` et `schedule_service_reads` sont créées automatiquement au démarrage, sans modifier les horaires. Aucune nouvelle variable ni dépendance n’est nécessaire. La branche doit être revue et déployée pour rendre la fonction disponible. Le fichier Render configure le déploiement sur commit : fusionner dans la branche suivie peut déclencher un déploiement.

Exécuter `npm ci`, `npm run check` et `npm test`. Les tests de discussion utilisent PostgreSQL embarqué et des sessions employé réelles avec des données fictives; aucun message réel ni courriel n’est envoyé.

## Limites de cette première version

Il n’y a pas encore de notifications push lorsque la page est fermée ou le téléphone verrouillé. L’interface l’indique explicitement. Il faudra configurer les notifications Web Push et les vérifier sur les appareils de l’équipe avant de remplacer entièrement Messenger. Aucun courriel automatique, message privé, groupe d’un autre département, modification ou suppression de message n’est ajouté.

Les photos augmentent la taille de la base; prévoir le suivi du stockage et une politique de conservation avant un usage prolongé. Les messages et photos restent privés à la discussion mais sont visibles par tous les membres du Service et ses gestionnaires.
