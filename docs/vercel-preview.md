# Préversion Vercel de Quart Service

La préversion Express utilise le commit Git, Node 24 et le fichier `vercel.json` du dépôt. La commande d’installation copie les cinq bibliothèques navigateur de la version verrouillée par npm vers `public/vendor`. Le serveur exporte l’application Express pour Vercel. Sur Render, `npm start` continue à ouvrir le port du service.

Dans le projet Vercel de test, utiliser les variables Preview existantes de l’application. Définir aussi `QUART_PREVIEW_PROJECT_REF`, `QUART_PREVIEW_SCHEMA` et `QUART_PREVIEW_DB_ROLE` pour le jeu de données à tester. Le serveur vérifie le certificat Supabase, puis le rôle et le schéma effectivement ouverts avant son initialisation. Utiliser une adresse PostgreSQL directe ou un pooler en mode session compatible avec les options de connexion. Les tests de charge doivent distinguer le plafond de trois connexions par instance du nombre total de connexions sur Supabase.

Depuis une copie propre de la branche, lier le projet Vercel de test, puis lancer `vercel deploy --environment preview`. Les origines du portail et des notifications sont propres à cette préversion. Le domaine choisi pour une passkey doit rester stable. Vérifier `/health` dans une session Vercel autorisée après chaque déploiement. Les tâches périodiques et l’initialisation du schéma à chaque démarrage sont à traiter avant une bascule de production.
