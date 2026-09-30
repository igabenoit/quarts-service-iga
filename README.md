# Quarts Service IGA

Application Web pour construire les quarts nécessaires à la caisse, à la supervision et pour les emballeurs avant l’attribution des employés.

L’onglet Horaire permet d’importer une liste JSON d’employés dans la base privée, de corriger
leurs disponibilités, puis d’attribuer les quarts d’une semaine. L’import initial est accepté
uniquement quand la liste est vide. Les quarts attribués manuellement sont conservés lors
d’une nouvelle génération. Les quarts « Aide autre département » restent à couvrir séparément.
Les quarts sans candidat et les totaux par employé sont visibles avant l’impression.

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

## Demandes de congé

- Gestion : lien **Demandes de congé** dans l’application, ou /conges-gestion après connexion gestionnaire.
- Employés : ouvrir le lien d’horaire avec le code commun, sélectionner son nom puis **Faire une demande de congé**. Le code commun ne vérifie pas individuellement l’identité; le motif et le courriel restent réservés à la gestion.
- Préavis : avant 9 h le jeudi précédant la première semaine du congé (lundi à dimanche), selon America/Toronto; à 9 h exactement, la demande est hors délai. La date et l’heure de remise proviennent de la base de données. Les tentatives hors délai sont conservées séparément avec le statut « Hors délai » pour le suivi et ne peuvent pas être approuvées par ce formulaire.
- Périodes : dates inclusives, journées complètes ou heures identiques pour chaque journée de la période. Ajouter une période pour des heures différentes. Séparer les périodes qui passent minuit.
- Une demande peut couvrir plusieurs semaines : elle est comptée une seule fois et ses plages approuvées sont appliquées à toutes les semaines, y compris celles créées ultérieurement. Les demandes en attente ne bloquent pas les quarts.
- Un conflit avec un quart déjà attribué empêche l’approbation; la gérante doit d’abord corriger l’affectation. L’annulation conserve l’historique et ne rétablit pas automatiquement des affectations. Les journées bloquées manuellement restent indépendantes.
- Tests : /conges-test, accessible avec la session gestionnaire. Les demandes de test ne sont liées à aucun employé réel et sont exclues par défaut des statistiques et de l’horaire.
- Le courriel saisi est une coordonnée de suivi. Les notifications Resend sont limitées aux tests : configurer le destinataire dans le suivi, puis RESEND_API_KEY et RESEND_FROM_EMAIL (expéditeur validé) dans Render. RESEND_FROM ou EMAIL_FROM sont aussi reconnus; sans expéditeur, onboarding@resend.dev est utilisé, uniquement selon les limites du compte de test Resend. LEAVE_TEST_NOTIFY_EMAIL peut fournir le destinataire initial. Aucun secret n’est renvoyé au navigateur. Les envois sont mis en file dans la même transaction que la demande; les reprises utilisent une clé d’idempotence et cessent après 20 heures pour vérification manuelle. « Pris en charge par Resend » ne confirme pas la livraison en boîte de réception. Les instances Render en veille reprennent la file au réveil.
- Les nouvelles tables sont créées automatiquement au démarrage; aucun changement destructif n’est nécessaire.

Validation : npm run check et npm test. Les tests de règles couvrent le jeudi à 9 h (heures d’été et d’hiver), le fuseau horaire, les dates invalides, les périodes multisemaines, les conflits partiels et les statistiques.
