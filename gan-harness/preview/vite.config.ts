import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const here = __dirname;
const mock = (name: string) => path.resolve(here, 'mocks', name);

// Les trois dépendances qui exigent le backend sont substituées, quel que soit
// le chemin relatif par lequel la page ou un sous-composant les importe.
export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^(\.{1,2}\/)+services\/userService$/, replacement: mock('userService.ts') },
      { find: /^(\.{1,2}\/)+UserContext$/, replacement: mock('UserContext.tsx') },
      { find: /^(\.{1,2}\/)+components\/Sidebar$/, replacement: mock('Sidebar.ts') },
      { find: '@', replacement: path.resolve(here, '../..') },
    ],
  },
  server: { fs: { allow: [path.resolve(here, '../..')] } },
});
