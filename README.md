# Quarts Service IGA

Application Web pour construire les quarts nécessaires à la caisse, à la supervision et pour les emballeurs avant l’attribution des employés.

L’onglet Horaire permet d’importer une liste JSON d’employés dans la base privée, de corriger
leurs disponibilités, puis d’attribuer les quarts d’une semaine. L’import initial est accepté
uniquement quand la liste est vide. Les quarts attribués manuellement sont conservés lors
d’une nouvelle génération. Les quarts « Aide autre département » restent à couvrir séparément.
Les quarts sans candidat et les totaux par employé sont visibles avant l’impression.

Les heures souhaitées servent de cible à la génération. L’option de dépassement permet
de compléter les quarts libres au-delà de cette cible, jusqu’au maximum hebdomadaire.
Une attribution manuelle peut déjà dépasser la cible, avec ou sans cette option.
Le « Maximum / semaine », les disponibilités, les congés et les limites de jours et
de mineurs restent applicables. Un refus d’attribution indique la contrainte précise.

## Variables requises

- `DATABASE_URL`
- `SESSION_SECRET`
- `MANAGER_CODE`

## Développement

```bash
npm install
npm run check
npm start
```

## Annuler la dernière action

La touche « Annuler la dernière action » fonctionne directement, sans aperçu, dans l’horaire et le suivi des congés. Le libellé précise l’action qui sera annulée. Ctrl+Z (ou Cmd+Z) déclenche le même retour hors des champs de saisie. Plusieurs clics remontent les actions successives. L’historique est commun aux gestionnaires et persiste après un rechargement.

Sont enregistrés : ajouts, modifications et suppressions de quarts, affectations, générations, copie de semaine, budgets et notes, fiches employés et congés manuels, décisions de congé et application des congés. L’enregistrement d’une fiche employé et de ses congés constitue une seule action. Une annulation rétablit uniquement les lignes modifiées par cette commande, avec les affectations supprimées en cascade. L’historique des décisions de congé est conservé. Les réglages de connexion, de partage et de courriel ne font pas partie de ce retour.

Chaque commande et son historique sont enregistrés dans la même transaction. Les erreurs et opérations sans changement ne consomment pas le retour. Une action plus récente ou des données modifiées hors de cet historique bloquent un retour périmé. Les actions antérieures à la mise en service ne sont pas récupérables. Les sauvegardes techniques des recréations de la version précédente restent conservées.

Les tests d’annulation utilisent PostgreSQL embarqué (PGlite, dépendance de développement) : exécuter npm ci puis npm test.

## Employés inactifs et départs définitifs

Décocher « Employé actif » correspond à une absence temporaire (par exemple un arrêt maladie de longue durée) : la fiche reste dans la liste. « Retirer de la liste — départ définitif », visible lors de la modification d’une fiche, masque l’employé et l’exclut des nouvelles propositions d’affectation. Les quarts déjà attribués et l’historique restent conservés; les quarts à venir doivent être vérifiés par le gestionnaire. La touche Annuler peut rétablir la fiche et son statut antérieur.

## Demandes de congé

- Gestion : lien **Demandes de congé** dans l’application, ou /conges-gestion après connexion gestionnaire.
- Employés : ouvrir /conges avec le code commun, inscrire son prénom et son nom, puis choisir son département. Le bouton de l’horaire et public/conges-qr.svg pointent vers cette adresse permanente. Le code commun ne vérifie pas individuellement l’identité; le motif et le courriel restent réservés à la gestion.
- Préavis : avant 9 h le jeudi précédant la première semaine du congé (lundi à dimanche), selon America/Toronto; à 9 h exactement, la demande est hors délai. La date et l’heure de remise proviennent de la base de données. Les tentatives hors délai sont conservées séparément avec le statut « Hors délai » pour le suivi et ne peuvent pas être approuvées par ce formulaire.
- Dates inclusives : toutes les journées sont affichées automatiquement. Pour chacune, choisir journée complète ou heures d’absence avec des boutons aux 15 minutes. Un résumé précède l’envoi; aucun ajout manuel de période n’est nécessaire. La fin de journée est représentée par 24:00, autorisé seulement comme heure de fin.
- Une demande peut couvrir plusieurs semaines : elle est comptée une seule fois et ses plages approuvées sont appliquées à toutes les semaines, y compris celles créées ultérieurement. Les demandes en attente ne bloquent pas les quarts.
- L’approbation libère uniquement les affectations de l’employé qui chevauchent le congé, dans la même transaction que la décision. Les besoins de quarts et toutes les autres affectations sont conservés. Les quarts libérés restent « À couvrir » pour choisir un remplaçant. Les retraits sont consignés dans l’historique de la demande. Pour les congés déjà approuvés, « Appliquer les congés approuvés » effectue ce même ajustement sur la semaine affichée, sans recréer l’horaire. Une deuxième application sans nouveau conflit ne change rien. L’annulation conserve l’historique et ne rétablit pas automatiquement des affectations. Les journées bloquées manuellement restent indépendantes.
- Si une nouvelle demande répète des périodes déjà approuvées, l’approbation ajoute uniquement les périodes supplémentaires. La demande originale reste visible et le suivi précise les périodes effectivement ajoutées. Les périodes répétées restent rattachées à leur demande initiale, notamment pour une annulation. Une demande entièrement couverte est signalée sans modification de l’horaire.
- Tests : /conges-test, accessible avec la session gestionnaire. Les demandes de test ne sont liées à aucun employé réel et sont exclues par défaut des statistiques et de l’horaire.
- Le courriel saisi est une coordonnée de suivi. Les notifications réelles vont au courriel du département, avec une copie générale facultative (sans doublon pour la même adresse); les tests vont uniquement au destinataire de test. Configurer les départements et les destinataires dans le suivi, puis RESEND_API_KEY et RESEND_FROM_EMAIL (expéditeur validé) dans Render. RESEND_FROM ou EMAIL_FROM sont aussi reconnus; sans expéditeur, onboarding@resend.dev est utilisé, uniquement selon les limites du compte de test Resend. LEAVE_TEST_NOTIFY_EMAIL peut fournir le destinataire initial. Aucun secret n’est renvoyé au navigateur. Les envois sont mis en file dans la même transaction que la demande; les reprises utilisent une clé d’idempotence et cessent après 20 heures pour vérification manuelle. « Pris en charge par Resend » ne confirme pas la livraison en boîte de réception. Les instances Render en veille reprennent la file au réveil.
- Les nouvelles tables sont créées automatiquement au démarrage; aucun changement destructif n’est nécessaire.

Validation : npm run check et npm test. Les tests de règles couvrent le jeudi à 9 h (heures d’été et d’hiver), le fuseau horaire, les dates invalides, les périodes multisemaines, les conflits partiels et les statistiques.

Le formulaire permanent reprend initialement le code du dernier horaire partagé; son code devient ensuite indépendant des semaines et peut être changé dans le suivi sans changer le QR. Les adresses des départements sont conservées en base privée. Les statistiques incluent tous les départements avec un filtre et un récapitulatif. Un nom saisi au Service doit être relié explicitement à un employé de l’horaire avant approbation; les autres départements ne modifient pas les quarts du Service.


## Confirmation des approbations et courriels des employés

Chaque nouvelle approbation met sa confirmation dans une file transactionnelle distincte des notifications au département. Le message va seulement au courriel de la demande, même si les notifications au département sont désactivées. Il contient les périodes effectivement ajoutées, le département et la référence, sans motif privé ni note de gestion. Le responsable du département est proposé comme adresse de réponse. Les approbations antérieures à cette fonction ne déclenchent aucun envoi rétroactif. Les tests vont exclusivement au destinataire de test.

La file attend au moins 15 secondes avant le premier traitement (passage toutes les 30 secondes), annule les envois en attente lorsque la décision ou sa version change, fige le contenu avant l’envoi et réutilise sa clé d’idempotence pour les reprises. Après 20 heures depuis la première tentative, une vérification dans Resend est requise. L’état est visible sur chaque demande. Un courriel déjà pris en charge par Resend ne peut pas être retiré par Annuler; une décision modifiée ensuite doit être communiquée à l’employé par la gestion. Aucun nouvel envoi automatique de refus ou d’annulation n’est ajouté.

/courriels est accessible depuis l’horaire et le suivi des congés. Son API et ses modifications exigent une session gestionnaire; les écritures exigent aussi la même origine. Les compteurs comparent les adresses aux employés actifs non retirés du Service. Les demandes réelles, y compris archivées, alimentent la liste. Un lien existant ou une correspondance de nom normalisé unique au Service permet le rapprochement; plusieurs adresses distinctes demandent un choix explicite. Les adresses non rapprochées peuvent être reliées manuellement sans modifier la demande ni l’horaire. Une adresse choisie par la gestion reste prioritaire. Les employés inactifs/retirés et les tests sont exclus de la copie Cci. L’export de toutes les adresses reçues inclut les anciens employés, sans les tests. La copie Cci est dédoublonnée. Les CSV neutralisent les formules. Les préférences et liens de contact sont conservés dans des tables privées distinctes et ne font pas partie de l’annulation des horaires.

La liste se recharge à l’ouverture, au retour dans l’onglet et toutes les minutes lorsqu’elle est visible, sans écraser une saisie en cours. Les tests d’envoi utilisent un fournisseur simulé et PostgreSQL embarqué; aucun courriel réel n’est envoyé par la suite de tests.


## Disponibilités permanentes

Le formulaire /disponibilites reprend les exigences du formulaire papier, sans importer la fiche remplie du scan. Il utilise le même code commun que les congés et ne propose que les employés actifs non retirés. Le nom est choisi dans la liste; la gestion doit toujours vérifier l’identité déclarée. Les champs requis sont le nom, la date effective, les heures souhaitées, le courriel, un choix explicite pour chacun des cinq jours de semaine et l’attestation « J’ai lu et compris ». Le courriel sert à confirmer l’approbation et alimente l’annuaire privé. Le QR permanent se trouve dans public/disponibilites-qr.svg.

Le serveur et le formulaire imposent samedi et dimanche de 7 h 30 à 21 h 30, au moins deux soirées couvrant 17 h à 21 h 30 du lundi au vendredi, dont au moins le jeudi ou le vendredi. Commencer avant 17 h est permis. Une seule plage par jour, aux 15 minutes, est proposée dans cette première version. Les commentaires ne remplacent aucune règle. Les heures souhaitées doivent respecter le maximum de la fiche et la limite existante de l’application pour les mineurs.

La durée minimale est de 28 jours calendaires entre les dates effectives de deux versions. Une demande peut être déposée à l’avance pour une date admissible; elle ne peut pas entrer en vigueur pendant les quatre premières semaines de la version précédente. Une seule demande réelle en attente par employé est autorisée. La validation est refaite à l’approbation, notamment si le maximum d’heures ou la dernière disponibilité a changé depuis la soumission. Une référence UUID rend les reprises d’envoi idempotentes. Les demandes refusées ou annulées ne consomment pas le délai. Les anciennes fiches n’ayant pas de date effective connue restent utilisables; aucun faux historique ne leur est attribué.

Le suivi gestionnaire /disponibilites-gestion présente la grille proposée, les différences avec la fiche en vigueur, l’historique et les états des courriels. L’approbation enregistre atomiquement la version datée dans availability_history de la fiche employé. La première version conserve une copie de la grille précédente comme référence de départ. Les champs physiques availability et target_minutes contiennent la version la plus récente enregistrée; toute lecture métier passe par employeeAvailability/profileAt pour choisir la bonne date. La fiche affiche la grille en vigueur aujourd’hui et les dates des versions approuvées à venir. Aucune tâche quotidienne n’est nécessaire pour activer une date : les lectures et affectations la résolvent directement.

La grille d’horaire charge les employés pour la semaine affichée. Chaque journée utilise sa propre date, y compris lors d’un changement en milieu de semaine. Les heures souhaitées forment une cible hebdomadaire pour la semaine contenant la date effective. L’attribution manuelle, la génération et la restauration des sauvegardes respectent cette résolution. Les quarts déjà attribués ne sont pas déplacés par une approbation; les conflits sont signalés dans le suivi et l’horaire. Une baisse d’heures souhaitées ne retire pas des quarts existants.

Les éditions directes de la fiche par la gestion restent possibles pour les corrections autorisées. Une grille future approuvée doit être annulée avant une modification manuelle de la grille actuelle. Les changements manuels de disponibilité/heures souhaitées sont datés du jour et deviennent aussi le point de départ du délai de quatre semaines pour les demandes des employés. Une révision de la fiche empêche une page ancienne d’écraser une décision plus récente ou une nouvelle version entrée en vigueur entretemps.

La touche Annuler restaure ensemble la décision et les versions de la fiche. Les versions de demande augmentent lors d’un retour pour invalider les confirmations en attente. Une annulation explicite d’approbation exige que cette version soit la plus récente de l’employé. Les événements restent conservés. Les anciennes captures d’annulation sont enrichies de la valeur par défaut availability_history=[] lors de la migration, sans effacer l’historique.

Les courriels utilisent les réglages existants du Service et la copie à la direction pour la réception; l’approbation est confirmée seulement à l’employé. Le contenu est figé dans une file transactionnelle, les reprises conservent une même clé d’idempotence et cessent après 20 heures pour vérification. Le mode /disponibilites-test est réservé à la gestion, ne modifie aucune fiche et envoie seulement au destinataire de test. Un courriel déjà envoyé ne peut pas être retiré par Annuler. Aucun envoi rétroactif n’est créé.

Validation : syntaxe, suite node:test dont PostgreSQL embarqué (validation, identité, doublons, 28 jours, effet par date, approbation, annulation, conflits, fiche périmée, courrier simulé), puis vérification locale de l’interface aux largeurs 320, 390, 768 et 1280 pixels. Les tests ne soumettent aucune vraie demande et n’envoient aucun courriel réel.
