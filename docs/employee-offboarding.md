# Fin d’emploi et accès personnels

Le départ définitif au Service, ou la désactivation de la fiche principale dans un autre département, bloque les accès personnels aux horaires, au chat, aux congés, aux disponibilités et aux commandes de vêtements. Les comptes de gérants doivent être rattachés à la fiche principale de leur employé dans **Gestion des accès**. Plusieurs comptes peuvent appartenir à la même personne; tous sont bloqués lorsque cette fiche devient inactive.

Les droits sont vérifiés en base à chaque requête et avant l’envoi des notifications. Les anciennes sessions sont invalidées par une version d’accès qui augmente lors de la désactivation, dans la même transaction. Annuler un départ peut rétablir la fiche, mais ne ressuscite ni les anciennes sessions ni les anciens abonnements aux notifications. Une nouvelle connexion et une nouvelle activation des notifications sont alors nécessaires.

Les pages ouvertes vérifient la session toutes les cinq secondes lorsqu’elles sont visibles, et au retour au premier plan. Le serveur refuse les requêtes dès que le départ est enregistré. Les informations déjà copiées, téléchargées ou reçues sur un appareil ne peuvent pas être retirées à distance.

Les anciens codes communs et cookies `leave_access` / `schedule_view` ne donnent plus aucun droit. Les anciennes routes de connexion et de configuration répondent HTTP 410. Les liens et QR des formulaires restent les mêmes; ils demandent maintenant le code employé personnel de six chiffres.

## Migration des comptes de gérants existants

Le changement ajoute `person_id` aux comptes de gérants. Aucune identité n’est déduite du nom : un homonyme ne doit jamais provoquer la fermeture du mauvais compte. Un compte sans rattachement est bloqué jusqu’à sa liaison, par l’administrateur, avec la bonne fiche. La gestion des accès affiche explicitement les comptes à rattacher et les fiches inactives. Les sessions des gérants doivent être renouvelées après ce rattachement.

Préparer les correspondances avant la mise en ligne et effectuer les rattachements avec l’administrateur à la mise en service. L’accès administrateur propriétaire est conservé pour cette opération. Il est distinct des comptes de gérants et ne doit pas être partagé avec les employés.

Les migrations ne suppriment aucun horaire, message, compte ni historique. Les colonnes et triggers sont ajoutés de manière idempotente. Le compteur d’accès appartient à la fiche personnelle et ne fait pas partie de l’historique d’annulation des horaires.

## Vérification

`test/departure-access.test.js` utilise la véritable application, des cookies signés et une base PostgreSQL embarquée avec des personnes fictives. Il vérifie plusieurs appareils, plusieurs comptes de gérant pour une personne, les liens directs, les formulaires, les anciens cookies communs, un départ refusé pour conflit de version, et l’invalidité des anciennes sessions après annulation du départ. Les tests de notifications vérifient aussi la révocation avant envoi; `test/access-session.test.js` couvre la suppression de l’affichage et les pannes réseau.
