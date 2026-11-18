// Configuration. Rien de secret ici : l'adresse du script et la clé se saisissent dans l'app.
export const CONFIG = {
  // Nom écrit dans la colonne "Utilisateur" (prévu pour un futur 2e utilisateur)
  USER: 'Baptiste',

  HORS_PROJET_NAME: 'Hors projet',

  // Valeurs par défaut si l'onglet "App" est illisible
  DEFAULT_STAGES: [
    ['ETUDE DEVIS', false], ['ETUDE TECHNIQUE', false], ['DEBIT', false], ['USINAGE', false],
    ['ENCOLLAGE', false], ['PONCAGE', false], ['FOND/APRET', true], ['EGRENNAGE', false],
    ['VERNI/LAQUE', true], ['MONTAGE', false], ['PREPARATION', false], ['LIVRAISON', false],
  ],
  DEFAULT_HORS: ['Devis / administratif', 'Achats / déplacements', 'Rangement / entretien atelier', 'Autre'],

  LOCK_AFTER_BACKGROUND_SECONDS: 30,
  VERSION: '1.2.0',
};
