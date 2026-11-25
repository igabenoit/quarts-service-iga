# Envoi du formulaire de congé

Dans la gestion des congés, la direction peut envoyer le lien du formulaire à une seule adresse, avec une salutation facultative. L’aperçu reprend le même gabarit HTML que l’envoi. Le courriel existe aussi en texte brut et rappelle l’accès personnel, les dates et heures, le motif, l’échéance du jeudi avant 9 h et la validation du responsable.

« Préparer mon test » remplit igabenoit@gmail.com et choisit /conges-test, qui exige la connexion de gestion. L’envoi demeure une action explicite. Les demandes d’essai et leurs avis de suivi utilisent le processus isolé existant; aucun courriel n’est envoyé par la migration ou la publication.

L’API privée confirme uniquement une réponse Resend réussie accompagnée d’un identifiant. Cela confirme la prise en charge, pas la livraison dans la boîte. Chaque envoi conserve son contenu et sa référence en base. Une reprise garde la même clé fournisseur; au-delà de 20 heures, un envoi incertain exige une vérification manuelle. La référence du dernier essai reste dans la session du navigateur après rechargement.

La publication ajoute seulement schedule_leave_form_mail au schéma privé des horaires. Le script prepare-leave-form-mail.mjs utilise le rôle applicatif existant pendant le build Production, vérifie l’origine et le marqueur 20261113.5, crée le registre avec RLS et enregistre 20261125.1 dans une transaction. Il ne modifie aucune demande, aucun horaire ni le coffre RH. L’ancien marqueur reste utilisable en cas de retour à la version précédente. La préversion utilise la préparation habituelle du schéma.

Validation : node --test test/leave-form-mail.test.js, vérification syntaxique et parcours du navigateur avec le serveur de test et un fournisseur simulé. La réception réelle est à vérifier par le test de la direction.
