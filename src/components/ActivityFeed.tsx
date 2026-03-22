import React from 'react';
import { IconPaperclip, IconLink, IconAlignLeft, IconChevronDown, IconMessageCircle, IconHeart, IconChecklist, IconPencil, IconUser, IconFileText } from '@tabler/icons-react';

interface ActivityItem {
  id: string;
  user: { name: string; avatar: string };
  action: string;
  target: string;
  timestamp: string;
  category: string;
  type: 'edit' | 'comment' | 'task' | 'action';
  attachments?: string[];
}

const mockActivities: ActivityItem[] = [
  {
    id: '1',
    user: { name: 'Khaldoun sektaoui', avatar: 'https://picsum.photos/seed/khaldoun/32/32' },
    action: 'Affaire par Khaldoun sektaoui',
    target: '18001 URPS CHIRURGIENS DENTISTES',
    timestamp: 'il y a 7 ans',
    category: 'Affaires',
    type: 'edit',
    attachments: ['image_preview.jpg']
  },
  {
    id: '2',
    user: { name: 'Alexia CIMEN', avatar: 'https://picsum.photos/seed/alexia/32/32' },
    action: 'a quitté le réseau d\'employés',
    target: '',
    timestamp: 'il y a 5 ans',
    category: 'Réseau d\'employés',
    type: 'action'
  }
];

export default function ActivityFeed() {
  return (
    <div className="card h-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-zinc-900 dark:text-zinc-100 text-2xl font-bold leading-none tracking-tight">Flux d'activité</h2>
        <button className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200">Activités masquées</button>
      </div>

      <div className="mb-6 p-4 border border-zinc-200 dark:border-zinc-800 rounded-lg">
        <textarea 
          placeholder="Partagez quelque chose. Utilisez @ pour mentionner des personnes."
          className="w-full bg-transparent border-none outline-none text-sm resize-none"
          rows={2}
        />
        <div className="flex justify-between items-center mt-2">
          <div className="flex gap-2 text-zinc-500">
            <IconPaperclip size={18} />
            <IconLink size={18} />
            <IconAlignLeft size={18} />
          </div>
          <button className="flex items-center gap-1 bg-blue-900 text-white px-4 py-1.5 rounded-full text-sm font-medium">
            Partagez <IconChevronDown size={16} />
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {mockActivities.map(activity => (
          <div key={activity.id} className="flex gap-3">
            <img src={activity.user.avatar} alt={activity.user.name} className="w-10 h-10 rounded-full" />
            <div className="flex-1">
              <p className="text-sm">
                <span className="font-bold text-blue-600">{activity.user.name}</span> {activity.action}
              </p>
              {activity.target && <p className="font-bold text-zinc-900 dark:text-zinc-100">{activity.target}</p>}
              <p className="text-xs text-zinc-500">{activity.timestamp} · <span className="text-green-600">{activity.category}</span> · Commentaire · Aimer · Tâche</p>
              {activity.attachments && (
                <div className="mt-2 w-24 h-24 bg-zinc-200 dark:bg-zinc-800 rounded-lg flex items-center justify-center">
                  <IconFileText size={32} className="text-zinc-400" />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
