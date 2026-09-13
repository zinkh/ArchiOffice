// Importé une fois par server.ts pour son effet de bord : chaque adaptateur
// s'enregistre lui-même auprès de providerFactory.ts au chargement.
//
// Un fournisseur absent de cette liste n'est pas « à moitié branché » : sa carte
// n'apparaît pas dans les Réglages, et une ligne de connexion qui le désignerait
// malgré tout échoue avec un message explicite (voir createProvider).
import './webdav';
