# Discussion du Service

La page `/discussion` ajoute une discussion commune au portail employé. Le lien apparaît après vérification de l’appartenance au Service, avec le nombre de messages non lus. Les gestionnaires autorisés au Service et l’administration ouvrent `/discussion?mode=manager` depuis leur navigation.

Fonctions : messages texte (4 000 caractères), une photo JPEG/PNG/WebP par message (2 Mo maximum), historique paginé, actualisation toutes les 5 secondes lorsque la page est visible, compteur de non-lus dans le portail (15 secondes), et jusqu’à dix annonces épinglées par les gestionnaires. Les photos et messages sont conservés dans PostgreSQL. Aucun stockage sur le disque éphémère de Render.

L’identité de l’auteur est déterminée sur le serveur. Les employés doivent avoir une session personnelle valide et être actifs au Service (fiche Service ou appartenance explicite au département). Les dossiers liés sont ceux résolus par le portail existant. Les sessions familiales, les codes communs et les gestionnaires d’autres départements ne donnent pas accès à cette discussion. Les accès sont revérifiés pour chaque lecture, photo et écriture. L’administrateur utilisant le code partagé signe « Administration »; un compte personnel de gestionnaire signe sous son nom.

Les messages sont rendus comme du texte. Les écritures utilisent la protection d’origine existante, la limite d’envoi est de 20 messages par minute par identité, et une clé d’idempotence évite les doublons après une réponse réseau perdue. Les curseurs de lecture ne reculent pas; un message n’est marqué lu que lorsque la discussion est au bas, visible et au premier plan.

## Déploiement et validation

Les tables de discussion et de notifications sont créées automatiquement au démarrage, sans modifier les horaires. La dépendance `web-push` est verrouillée dans `package-lock.json`. Aucune nouvelle variable Render n’est nécessaire : une paire VAPID est générée une fois et conservée en base; la clé privée est chiffrée par AES-GCM avec une clé dérivée de `SESSION_SECRET`. Conserver cette variable stable; sa rotation nécessite de rechiffrer la clé VAPID avant le redémarrage. La fusion dans la branche suivie déclenche le déploiement Render configuré sur commit.

Exécuter `npm ci`, `npm run check` et `npm test`. Les tests de discussion utilisent PostgreSQL embarqué et des sessions employé réelles avec des données fictives; aucun message réel ni courriel n’est envoyé.

## Notifications même lorsque le site est fermé

Après connexion, utiliser **Activer les notifications** sur chaque appareil, accepter la permission du système, puis **Tester**. Sur iPhone/iPad (iOS 16.4+), ajouter la page à l’écran d’accueil depuis Safari et ouvrir ce raccourci avant l’activation. Sur Android, utiliser un navigateur compatible comme Chrome. Le manifeste `/service-chat.webmanifest` installe « Service IGA »; le service worker `/service-chat-sw.js` reçoit les alertes et ouvre la discussion, sans mettre les messages ou photos en cache.

Le destinataire n’a pas besoin de garder une page ouverte ni une session Web non expirée. Son droit actuel au Service et une empreinte de son code ou de la version de son compte sont revérifiés avant chaque envoi. Un code changé, un compte désactivé ou un départ du Service invalide l’abonnement. La déconnexion depuis le portail ou la discussion révoque les notifications du navigateur courant; les autres appareils restent activés. Un appareil partagé ne conserve qu’une identité par abonnement. Les endpoints et clés d’abonnement ne sont jamais renvoyés à d’autres utilisateurs.

Chaque nouveau message inscrit les envois dans une file PostgreSQL **dans la même transaction** que le message, en excluant tous les appareils de l’auteur. Les reprises d’un même message n’ajoutent pas d’envois. Un worker démarre dès l’enregistrement, au démarrage du serveur et toutes les 30 secondes. Les baux limitent les doublons entre instances; les erreurs temporaires sont réessayées avec délai progressif, au maximum huit tentatives pendant 24 heures. Une erreur 404/410 supprime l’abonnement expiré. Le fournisseur garde une alerte jusqu’à l’expiration du TTL pour un appareil hors connexion. Le tag stable par message limite les doublons visibles après une reprise ambiguë.

Le contenu transmis aux fournisseurs et affiché sur l’écran verrouillé est uniquement « Un nouveau message attend l’équipe du Service ». Aucun nom, texte du message ou photo n’y est inclus. Les abonnements n’acceptent que les endpoints HTTPS Apple, FCM, Mozilla ou Windows prévus dans le validateur, afin d’éviter des requêtes vers un serveur arbitraire.

**Validation sur appareils réels avant migration complète :** activer sur deux téléphones de test autorisés, vérifier le bouton Tester, fermer l’application du destinataire puis envoyer un message depuis l’autre appareil. Vérifier l’alerte sur écran verrouillé, son ouverture, la désactivation et l’absence d’alerte après déconnexion. Les tests automatisés simulent les fournisseurs : ils ne prouvent pas la réception sur un téléphone.

Les permissions, modes de concentration, économies de batterie et connexions du téléphone peuvent retarder ou bloquer les notifications. Le plan gratuit Render indiqué dans `render.yaml` peut mettre le serveur en veille : un nouveau message le réveille et lance les envois, mais des reprises en attente peuvent attendre son prochain réveil. Aucun changement payant d’hébergement n’est effectué. Ne pas considérer les alertes comme un accusé de réception garanti.

Références : [Web Push sur iOS/iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [bibliothèque Web Push](https://github.com/web-push-libs/web-push), [veille des services Render gratuits](https://render.com/docs/free).

## Autres limites

Aucun courriel automatique, message privé, groupe d’un autre département, modification ou suppression de message n’est ajouté.

Les photos augmentent la taille de la base; prévoir le suivi du stockage et une politique de conservation avant un usage prolongé. Les messages et photos restent privés à la discussion mais sont visibles par tous les membres du Service et ses gestionnaires.
