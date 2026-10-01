export interface UserProfile {
  id: string;
  name: string;
  email: string;
  system_role: 'admin' | 'manager' | 'pm' | 'user';
  manager_id?: string | null;
  role?: string;
  avatar?: string;
}

export interface JoinRequest {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

const params = new URLSearchParams(window.location.search);
const empty = params.get('empty') === '1';
const slow = params.get('slow') === '1';
const fail = params.get('error') === '1';
const failWrite = params.get('failwrite') === '1';

// Portrait fictif en niveaux de gris, généré en SVG (aucune image distante).
const portrait =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#777"/><circle cx="40" cy="32" r="14" fill="#ddd"/><path d="M12 80c2-20 14-28 28-28s26 8 28 28z" fill="#ccc"/></svg>',
  );

const MEMBERS: UserProfile[] = [
  { id: 'u1', name: 'Hélène Marchand', email: 'helene.marchand@atelier-marchand.fr', system_role: 'admin', role: 'Architecte associée, gérante', avatar: portrait },
  { id: 'u2', name: 'Julien Castaing', email: 'julien.castaing@atelier-marchand.fr', system_role: 'manager', manager_id: 'u1', role: 'Architecte DPLG, directeur de production' },
  { id: 'u3', name: 'Camille Roux-Delmas', email: 'camille.roux@atelier-marchand.fr', system_role: 'manager', manager_id: 'u1', role: 'Responsable des études et du suivi de chantier' },
  { id: 'u4', name: 'Inès Bouchard', email: 'ines.bouchard@atelier-marchand.fr', system_role: 'pm', manager_id: 'u2', role: 'Cheffe de projet', avatar: portrait },
  { id: 'u5', name: 'Mathieu Lefèvre', email: 'mathieu.lefevre@atelier-marchand.fr', system_role: 'pm', manager_id: 'u3', role: 'Chef de projet, économiste' },
  { id: 'u6', name: 'Sofia Benali', email: 'sofia.benali@atelier-marchand.fr', system_role: 'user', manager_id: 'u2', role: 'Architecte collaboratrice' },
  { id: 'u7', name: 'Théo Vasseur', email: 'theo.vasseur@atelier-marchand.fr', system_role: 'user', manager_id: 'u3', role: 'Dessinateur projeteur' },
  { id: 'u8', name: 'Anaïs Pelletier', email: 'anais.pelletier@atelier-marchand.fr', system_role: 'user', manager_id: 'u4', role: 'Stagiaire, 4e année' },
  { id: 'u9', name: 'Étienne Gauthier', email: 'etienne.gauthier@atelier-marchand.fr', system_role: 'user', role: '' },
];

const REQUESTS: JoinRequest[] = [
  { id: 'r1', name: 'Lucie Fontaine', email: 'lucie.fontaine@gmail.com', created_at: '2026-09-28T09:12:00Z' },
  { id: 'r2', name: '', email: 'p.moulin@cabinet-moulin.fr', created_at: '2026-09-30T16:40:00Z' },
  { id: 'r3', name: 'Rémi Daoud', email: 'remi.daoud@outlook.fr', created_at: '2026-10-01T07:05:00Z' },
];

let members = empty ? [] : MEMBERS.map((m) => ({ ...m }));
let requests = REQUESTS.map((r) => ({ ...r }));
const wait = (ms = slow ? 1800 : 350) => new Promise((r) => setTimeout(r, ms));

export const getAllUsers = async (): Promise<UserProfile[]> => {
  await wait();
  if (fail) throw new Error('Failed to fetch users');
  return members.map((m) => ({ ...m }));
};

export const updateUserRole = async (id: string, role: UserProfile['system_role']): Promise<void> => {
  await wait(120);
  if (failWrite) throw new Error('write failed');
  members = members.map((m) => (m.id === id ? { ...m, system_role: role } : m));
};

export const updateUserManager = async (id: string, managerId: string | null): Promise<void> => {
  await wait(120);
  members = members.map((m) => (m.id === id ? { ...m, manager_id: managerId } : m));
};

export const createUser = async (user: Omit<UserProfile, 'id'>): Promise<UserProfile> => {
  await wait(600);
  const created = { ...user, id: `u${Date.now()}` };
  members = [...members, created];
  return { ...created, emailSent: true } as UserProfile;
};

export const getJoinRequests = async (): Promise<JoinRequest[]> => {
  await wait();
  return requests.map((r) => ({ ...r }));
};

export const decideJoinRequest = async (id: string, decision: 'approve' | 'reject'): Promise<void> => {
  await wait(500);
  const req = requests.find((r) => r.id === id);
  requests = requests.filter((r) => r.id !== id);
  if (decision === 'approve' && req) {
    members = [...members, { id: `n-${id}`, name: req.name || req.email, email: req.email, system_role: 'user', role: '' }];
  }
};
