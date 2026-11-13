# Déplacer la base des horaires en conservant le service Render

Le premier déploiement peut conserver sa connexion Render actuelle. Pour la bascule de la base, garder le même service web, son domaine et ses secrets applicatifs. Les employés continuent d’utiliser leurs liens et leurs clés d’accès sur cette origine. Le coffre des dossiers employés conserve sa connexion dédiée. Le changement de domaine et le déploiement de l’interface sur Vercel ont leur propre recette.

## Connexion à la cible

Dans l’environnement du service web, préparer ensemble les quatre réglages ci-dessous. La connexion Supabase utilise TLS avec vérification du certificat et un schéma privé. Les verrous de session et les transactions requièrent une connexion directe ou le pooler en mode session au port 5432.

| Variable | Valeur attendue |
| --- | --- |
| `DATABASE_URL` | Adresse PostgreSQL de la cible et mot de passe du rôle applicatif, dans le gestionnaire de secrets |
| `QUART_SUPABASE_PROJECT_REF` | Référence du projet Supabase de production |
| `QUART_SUPABASE_DB_ROLE` | Rôle applicatif propriétaire du schéma des horaires, distinct des rôles d’administration |
| `QUART_SUPABASE_SCHEMA` | Nom du schéma privé qui contient la copie complète des horaires et les autres tables applicatives |

La branche de Render exécute ses migrations au démarrage. Préparer le schéma et restaurer l’archive avant le premier démarrage. Garder ce schéma hors de la liste des schémas exposés par la Data API. Vérifier les droits de `PUBLIC`, `anon` et `authenticated` sur la cible. Conserver la valeur de `SESSION_SECRET` pour les données chiffrées et les accès existants.

## Rapprochement

Exécuter les commandes dans une session d’exploitation dont l’environnement pointe sur la base voulue. Le script n’émet que les noms de tables, les comptages, les empreintes et les états de séquences. Sur la source actuelle, il examine `public`. Sur la cible, il prend le schéma configuré. Mettre les écritures et les traitements en pause pour le rapprochement final. PostgreSQL peut faire avancer les séquences en dehors de l’instantané d’une transaction.

```sh
node scripts/reconcile-schedule.mjs > source.json
# Dans la session configurée pour la cible restaurée
node scripts/reconcile-schedule.mjs > cible.json
node scripts/reconcile-schedule.mjs --compare source.json cible.json
```

La comparaison retourne un code de sortie non nul et nomme chaque table ou séquence divergente. Effectuer la comparaison avant le démarrage applicatif pour distinguer les transformations prévues par les migrations. Comparer séparément les définitions des tables, colonnes, contraintes, index, fonctions, vues et déclencheurs, ainsi que les droits effectifs. Vérifier les lectures et publications habituelles avant la réouverture.

## Exécution et retour

1. Préparer la sauvegarde native et noter son point de récupération. Prévoir un moyen de restaurer sur une base de secours. Identifier le service qui écrit, y compris ses minuteurs, et disposer d’un accès privé pour exporter lorsque ce service sera arrêté.
2. Fermer l’accès en écriture, arrêter ou suspendre les traitements et confirmer que les transactions d’écriture ont terminé. Mettre la cible hors trafic et garder ses tâches et envois en pause.
3. Exporter avec un client compatible avec la version source. Pour une cible de version majeure inférieure, utiliser un schéma cible dont la compatibilité a été vérifiée et restaurer les données et séquences. Une restauration de données vers un schéma renommé exige une correspondance explicite des noms. La tester en répétition avant de l’utiliser.
4. Vérifier le rapprochement, puis déployer le réglage du service web avec ses quatre variables. Contrôler le commit et la base sur `/health`, la connexion d’un compte autorisé et son horaire. Vérifier les files et activer un seul consommateur.
5. Avant la reprise des écritures, le retour consiste à rétablir la connexion Render précédente et retirer les trois réglages Supabase. Refaire les contrôles avant réouverture. S’il y a déjà eu des écritures, figer les deux côtés, rapprocher les changements, les reporter sur la base de retour et vérifier les files déjà livrées avant de diriger le trafic vers elle.
