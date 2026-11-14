# Accès direction et Face ID

En production, le code maître n’accorde plus de session administrateur. Les anciens cookies issus de ce code ne sont plus reconnus. Le rôle direction vient exclusivement d’une clé d’accès vérifiée côté serveur et d’une fiche active dont l’identifiant interne figure dans `EMPLOYEE_PASSKEY_ADMIN_IDS`.

Le contrôle central `managerAccess.identity` est partagé par les horaires, SST, dossiers employés, gestion des accès, pièces jointes et exports. Il vérifie à chaque requête la session, sa durée, la révocation de la clé, la version d’accès et l’activité de la personne. Les clés des gérants sont reliées par identifiant interne à leur compte de gestion actif. Les départements sont relus à chaque requête; aucun rapprochement par nom ni cumul de comptes n’accorde des droits. Une clé d’employé ne peut emprunter un autre compte connecté dans le navigateur. La connexion par mot de passe des gérants reste disponible et n’ajoute pas de second facteur.

## Configuration et première connexion

En production, `EMPLOYEE_PASSKEY_MODE` doit valoir `pilot` ou `required`; `EMPLOYEE_PASSKEY_ORIGIN` doit être l’origine HTTPS exacte; `EMPLOYEE_PASSKEY_ADMIN_IDS` contient uniquement les identifiants internes des responsables autorisés. Une clé de direction existante est nécessaire avant cette mise à jour. Ne pas déployer dans un autre environnement de production sans préparer cette première clé par la procédure contrôlée.

Ouvrir `/connexion-employe?retour=%2Fcles-employes` et confirmer la clé déjà créée sur l’ordinateur. Cliquer sur « Afficher le QR pour mon iPhone ». Le QR est calculé localement par le serveur, jamais transmis à un fournisseur QR. Scanner sur l’iPhone, ouvrir dans Safari et enregistrer la clé avec le déverrouillage de l’appareil. Une addition conserve les clés et sessions existantes. La récupération reste une opération distincte qui révoque les anciennes clés.

Un QR est un lien personnel sensible, utilisable une fois et valable 15 minutes. Ne pas le partager ni le conserver dans un rapport. Le serveur déduit sa cible de la session authentifiée depuis moins de cinq minutes, vérifie la clé qui l’autorise et ignore tout identifiant de personne proposé par le navigateur.

Face ID est pris en charge par les clés d’accès sur les iPhone compatibles. Apple peut proposer le code de l’appareil en secours. Le serveur exige une vérification de l’utilisateur, mais ne reçoit pas son visage, ses données biométriques ni le code de son appareil. Il ne peut imposer une biométrie particulière ni prouver quel geste a été utilisé.

## Vérification et limites

Les essais fictifs couvrent le rejet du code maître correct, des anciens cookies, des clés d’employés sans rôle direction et des clés révoquées; les pièces et exports; deux authentificateurs distincts; l’ajout du téléphone sans couper le PC; l’expiration du QR et la déconnexion. Le test navigateur utilise des authentificateurs virtuels. Face ID doit encore être confirmé sur l’iPhone réel par son propriétaire.

Cette correction couvre ce projet, pas les autres applications hébergées dans d’autres services. Elle n’est pas une certification de conformité. La revue d’hébergement et l’EFVP, la conservation/destruction, les règles de consentement applicables, l’accès des gérants, les procédures de reprise et les autres constats de l’audit restent à traiter. La collecte du coffre RH canadien demeure désactivée tant que sa revue n’est pas approuvée.

La base d’identité et les clés publiques sont dans le projet Supabase Quart production au Canada. La localisation au Canada du coffre documentaire n’élimine pas les traitements et accès depuis l’étranger.

Sources : [Apple — clés d’accès sur iPhone](https://support.apple.com/fr-ca/guide/iphone/iphf538ea8d0/ios), [CAI — mesures de sécurité](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/information-entreprises-privees/incidents-confidentialite-mesures-securite-entreprises), [Commissariat — application de la LPRPDE aux dossiers du personnel](https://www.priv.gc.ca/fr/sujets-lies-a-la-protection-de-la-vie-privee/employeurs-et-employes/02_05_d_18/).

## Accueil après connexion

La direction ouvre `/index.html`. Les gérants ouvrent `/departements`, avec le département autorisé et la semaine courante. `MANAGER_INDEX_HOME_PERSON_IDS` permet de désigner une préférence `/index.html` pour un compte déjà autorisé au Service; cette variable ne confère aucun droit. La préférence de Badia a été demandée explicitement. Un retour vers les anciens horaires du magasin ou la vue employé est normalisé vers cet accueil après connexion. Les liens profonds vers les autres modules restent possibles.

## Mesures disciplinaires

Le menu Portail donne accès à la rédaction, au classement et aux pièces PDF dans le coffre RH. Direction et gérants autorisés utilisent le périmètre des départements; un gérant ne gère pas sa propre mesure. Les révisions et pièces sont immuables; retrait et correction conservent l’historique. Le classement ne constitue ni une signature ni une notification. Les deux nouvelles tables privées ont RLS et aucun accès client. La migration doit être appliquée dans le coffre avant publication sur Vercel; aucune migration de démarrage n’est exécutée en production.
