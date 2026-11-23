# Signature de l’employé et finalisation

Les formulaires de renseignements personnels, TUAC, retraite et SST 2026 permettent une signature de la partie employé avant la finalisation de la direction. Le premier PDF signé demeure un original privé immuable. Les réponses et le tracé de l’employé sont conservés dans le brouillon privé jusqu’à la finalisation; ils ne sont plus modifiables. Les API retirent toujours les métadonnées internes `_workflow` des réponses publiques.

La direction complète uniquement ses champs. La finalisation produit un second PDF, conserve une référence au premier et supprime le tracé temporaire du brouillon. Les documents complétés avant cette évolution restent inchangés. Aucune migration de schéma n’est nécessaire.

Configurer `ONBOARDING_DIRECTION_EMAIL` en production pour les avis « Document à finaliser ». À défaut, le courriel de suivi du dossier est utilisé. L’essai isolé conserve ses destinataires fixes. Le traitement périodique existant envoie les avis avec une clé d’idempotence et sans pièce jointe. Un employé dont toutes les parties sont signées ne reçoit plus de rappel pour les seules sections restantes de la direction.

Le TUAC utilise les trois fiches calibrées pour la feuille originale, format lettre, recto, taille réelle 100 %. `GET /api/employee-files/originals/:id?print=tuac-original` fournit une copie d’impression des anciens PDF à deux fiches reconnus, en reprenant les valeurs et le tracé présents dans le PDF. Cette opération conserve les contrôles d’accès et ne remplace jamais l’original. Les formats inconnus sont refusés. Le bouton de téléchargement du lecteur conserve l’original archivé.

Le régime de retraite et le formulaire d’urgence utilisent le PDF natif avec les préférences lettre, recto verso sur le bord long et sans ajustement; aucun en-tête ou pied de page HTML n’est ajouté. Le pilote d’impression doit respecter ces réglages.
