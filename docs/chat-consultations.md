# Consultations des messages

L’administrateur et les gérants du Service peuvent voir « Vu par… » sous leurs propres messages du groupe et leurs propres messages privés. La liste donne les noms et la première date de consultation. Un employé ordinaire ne dispose pas de cette fonction, y compris pour ses propres envois. Le serveur impose ces restrictions; un autre gérant ne peut pas consulter les accusés d’un message qu’il n’a pas envoyé.

Une consultation est enregistrée lorsque le message reste affiché au premier plan pendant environ une seconde. Le défilement, un onglet en arrière-plan, un panneau privé fermé, un message hors de l’écran ou une notification reçue ne constituent pas une consultation. Cela prouve l’affichage dans l’application, pas la lecture attentive ni la compréhension.

Le suivi utilise des enregistrements par message, sans déduire de vues des anciens compteurs « non lus ». Il commence avec cette version; « Aucune consultation enregistrée » ne prouve pas qu’un ancien message n’a jamais été lu. Les consultations sont conservées comme historique. Le départ de l’employé bloque tout nouvel accès, y compris ces routes. Plusieurs sessions personnelles ou comptes gérants liés à la même fiche comptent comme une personne.

Les listes se mettent à jour toutes les cinq secondes pour les messages affichés. Les nouvelles tables sont créées sans modifier les messages ni les compteurs existants. Les tests HTTP vérifient les restrictions, les conversations privées, les doublons, les données falsifiées et la révocation; les tests du navigateur simulent visibilité, focus et défilement.
