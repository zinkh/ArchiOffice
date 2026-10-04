import type { UserProfile } from '../../../src/services/userService';

const params = new URLSearchParams(window.location.search);
const admin = params.get('admin') !== '0';

const currentUser: UserProfile = admin
  ? { id: 'u1', name: 'Hélène Marchand', email: 'helene.marchand@atelier-marchand.fr', system_role: 'admin', role: 'Architecte associée, gérante' }
  : { id: 'u4', name: 'Inès Bouchard', email: 'ines.bouchard@atelier-marchand.fr', system_role: 'pm', manager_id: 'u2', role: 'Cheffe de projet' };

export function useUser() {
  return { currentUser };
}
