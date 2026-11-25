import { describe, expect, it } from 'vitest';
import { isYesNoQuestion } from '../packages/archioffice-agents/src/client/confirmationQuestion';

describe('isYesNoQuestion', () => {
  it.each([
    'J\'ai trouvé 3 factures en double. Voulez-vous que je les supprime ?',
    'Je crée la tâche « Relancer le lot 3 » ? (oui ou non)',
    '**Je confirme la suppression ?**',
    'Dois-je procéder à l\'envoi ? 🙂',
    'Tout est prêt. On y va ?',
  ])('détecte une question fermée : %s', content => {
    expect(isYesNoQuestion(content)).toBe(true);
  });

  it.each([
    'Quel lot souhaitez-vous modifier ?',
    'Voici le résumé du projet.',
    'Combien de lots dois-je créer ?',
    '',
    undefined,
  ])('ignore ce qui n\'est pas une confirmation : %s', content => {
    expect(isYesNoQuestion(content)).toBe(false);
  });
});
