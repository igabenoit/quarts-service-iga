# Déploiement et diagnostic

`npm ci` vérifie maintenant la syntaxe de tous les modules JavaScript (y compris les modules de navigateur importés par le serveur). Node est limité à la branche 24 pour éviter le passage implicite à une nouvelle version majeure. Le workflow Reliability exécute les tests sur les demandes de fusion et sur main. Render suit encore les commits : attendre les tests avant de fusionner.

`npm start` utilise `start.js`, qui journalise les échecs d’import et d’initialisation. Les phases du serveur distinguent configuration, schéma principal, accès gestionnaire, congés, départements, discussion/notifications, autres modules et écoute HTTP. Les erreurs ne contiennent ni requêtes SQL, ni mots de passe, ni destinataires, ni contenu des demandes. Les réponses aux écritures et les erreurs HTTP comportent un identifiant de requête; les routes journalisées utilisent les paramètres de route, pas les URL personnelles.

`GET /health` effectue `SELECT 1` et renvoie 503 si la base est indisponible. La connexion est limitée à 3 secondes et la requête à 1 seconde. La réponse n’est pas mise en cache; elle indique le commit Render et l’heure de démarrage. Une santé positive ne prouve pas la livraison des courriels ni le fonctionnement de chaque parcours.

## Notifications de discussion : plusieurs services

La clé privée VAPID est chiffrée avec `SESSION_SECRET`. Les différents services Render peuvent partager les données sans avoir la même clé de session : leurs clés VAPID, abonnements et files de notifications doivent donc être séparés. `RENDER_EXTERNAL_URL`, fourni par Render, détermine cet espace. Les identifiants SQL utilisent exclusivement un suffixe SHA-256 calculé, jamais une URL interpolée. L’initialisation est transactionnelle avec verrou consultatif.

L’origine historique `https://quarts-service-iga.onrender.com` conserve exactement les tables, clés, abonnements et travaux existants. Une autre origine reçoit ses propres tables. Le registre `schedule_service_push_origins` permet à un message partagé d’inscrire les notifications pour chaque origine dans la transaction du message. Chaque worker ne traite que ses propres abonnements, avec sa clé et son empreinte de compte.

Ne pas changer `SESSION_SECRET` pour résoudre ce problème : il protège également les sessions et d’autres données chiffrées. Une mauvaise clé pour une origine déjà initialisée provoque toujours un échec explicite `PUSH_KEY_DECRYPT_FAILED`; aucune régénération ni suppression automatique des abonnements. Un changement de nom/domaine Render nécessite de planifier la reprise de l’espace de notifications.

## Courriels

Les files de congés/disponibilités sont persistées en PostgreSQL. Les reprises conservent une clé d’idempotence et s’arrêtent pour vérification avant expiration de la fenêtre du fournisseur. Les résultats du fournisseur et les erreurs de worker/transaction sont maintenant journalisés avec le type de file et l’identifiant du travail. `ACCEPTED` signifie accepté par l’API, jamais livré dans la boîte. Les statuts de livraison/rebond exigent une vérification dans Resend. Les envois manuels de PDF nécessitent une relance depuis leur interface; le PDF n’est pas une pièce jointe persistée dans la file automatique.

## Validation et retour arrière

1. Exécuter `npm ci`, puis `node --test --test-concurrency=2 test/*.test.js`. Le test de démarrage lance le véritable serveur et ses sessions signées sur PostgreSQL embarqué persistant avec des données fictives; aucun fournisseur réel n’est appelé. Il teste les neuf départements, la publication et un redémarrage. Le test d’isolation lance deux services avec deux secrets sur une base commune.
2. Attendre le workflow Reliability avant fusion. Relever le SHA fusionné et vérifier chaque service Render séparément : build réussi, phase `ready`, déploiement `live`, puis `/health` avec le même SHA et `database: ok`.
3. Vérifier l’accès anonyme refusé et les parcours authentifiés sur comptes de test. Une vérification automatique locale ne prouve pas la réception de notifications sur iPhone/Android réels.
4. La migration est additive : aucune table d’horaires ou compte n’est supprimé ou réécrit. En cas de régression, redéployer le dernier commit validé du service principal; ses tables historiques restent compatibles. Laisser les nouvelles tables en place. Ce retour réintroduit l’ancien contrôle de santé et les anciens diagnostics. Sur le second service, revenir au commit antérieur à Web Push (`0a3e35dd4a82b1c8032fa793962a13f7ff3c537d`) plutôt qu’à un des cinq commits qui échouaient déjà. Les notifications entre origines ajoutées par le correctif ne sont alors plus garanties; rétablir rapidement le correctif validé. Ne pas effacer des données pour effectuer le retour arrière.

Les variables de messagerie, les clés privées, la configuration réelle de chaque service et les historiques de livraison restent privés. Le fichier `render.yaml` décrit un service gratuit; il ne remplace pas l’inventaire Render et ne décrit pas le plan réel du service principal.
