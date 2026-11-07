# Accès direction et Face ID

En production, le code maître n’accorde plus de session administrateur. Les anciens cookies issus de ce code ne sont plus reconnus. Le rôle direction vient exclusivement d’une clé d’accès vérifiée côté serveur et d’une fiche active dont l’identifiant interne figure dans `EMPLOYEE_PASSKEY_ADMIN_IDS`.

Le contrôle central `managerAccess.identity` est partagé par les horaires, SST, dossiers employés, gestion des accès, pièces jointes et exports. Il vérifie à chaque requête la session, sa durée, la révocation de la clé, la version d’accès et l’activité de la personne. Les comptes individuels des gérants conservent leur périmètre existant et leur méthode de connexion. Ils ne deviennent pas direction parce qu’ils possèdent une clé.

## Configuration et première connexion

En production, `EMPLOYEE_PASSKEY_MODE` doit valoir `pilot` ou `required`; `EMPLOYEE_PASSKEY_ORIGIN` doit être l’origine HTTPS exacte; `EMPLOYEE_PASSKEY_ADMIN_IDS` contient uniquement les identifiants internes des responsables autorisés. Une clé de direction existante est nécessaire avant cette mise à jour. Ne pas déployer dans un autre environnement de production sans préparer cette première clé par la procédure contrôlée.

Ouvrir `/connexion-employe?retour=%2Fcles-employes` et confirmer la clé déjà créée sur l’ordinateur. Cliquer sur « Afficher le QR pour mon iPhone ». Le QR est calculé localement par le serveur, jamais transmis à un fournisseur QR. Scanner sur l’iPhone, ouvrir dans Safari et enregistrer la clé avec le déverrouillage de l’appareil. Une addition conserve les clés et sessions existantes. La récupération reste une opération distincte qui révoque les anciennes clés.

Un QR est un lien personnel sensible, utilisable une fois et valable 15 minutes. Ne pas le partager ni le conserver dans un rapport. Le serveur déduit sa cible de la session authentifiée depuis moins de cinq minutes, vérifie la clé qui l’autorise et ignore tout identifiant de personne proposé par le navigateur.

Face ID est pris en charge par les clés d’accès sur les iPhone compatibles. Apple peut proposer le code de l’appareil en secours. Le serveur exige une vérification de l’utilisateur, mais ne reçoit pas son visage, ses données biométriques ni le code de son appareil. Il ne peut imposer une biométrie particulière ni prouver quel geste a été utilisé.

## Vérification et limites

Les essais fictifs couvrent le rejet du code maître correct, des anciens cookies, des clés d’employés sans rôle direction et des clés révoquées; les pièces et exports; deux authentificateurs distincts; l’ajout du téléphone sans couper le PC; l’expiration du QR et la déconnexion. Le test navigateur utilise des authentificateurs virtuels. Face ID doit encore être confirmé sur l’iPhone réel par son propriétaire.

Cette correction couvre ce projet, pas les autres applications hébergées dans d’autres services. Elle n’est pas une certification de conformité. La revue d’hébergement et l’EFVP, la conservation/destruction, les règles de consentement applicables, l’accès des gérants, les procédures de reprise et les autres constats de l’audit restent à traiter. La collecte du coffre RH canadien demeure désactivée tant que sa revue n’est pas approuvée.

La base d’identité et les clés publiques restent dans la base Render existante. La localisation au Canada du coffre documentaire n’élimine pas les traitements et accès depuis l’étranger.

Sources : [Apple — clés d’accès sur iPhone](https://support.apple.com/fr-ca/guide/iphone/iphf538ea8d0/ios), [CAI — mesures de sécurité](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/information-entreprises-privees/incidents-confidentialite-mesures-securite-entreprises), [Commissariat — application de la LPRPDE aux dossiers du personnel](https://www.priv.gc.ca/fr/sujets-lies-a-la-protection-de-la-vie-privee/employeurs-et-employes/02_05_d_18/).
