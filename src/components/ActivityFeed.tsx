import React, { useState, useEffect, useRef } from 'react';
import { IconPaperclip, IconLink, IconAlignLeft, IconChevronDown, IconMessageCircle, IconHeart, IconChecklist, IconPencil, IconUser, IconFileText } from '@tabler/icons-react';
import { useUser } from '../UserContext';
import { fetchJson } from '../lib/api';

interface ActivityItem {
  id: string;
  user_id: string;
  user?: { name: string; avatar: string };
  action: string;
  target: string;
  timestamp: string;
  category: string;
  type: 'edit' | 'comment' | 'task' | 'action' | 'message';
  attachments?: string[];
  content?: string;
}

export default function ActivityFeed() {
  const { currentUser, allUsers } = useUser();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFeed = async () => {
    try {
      const [acts, msgs] = await Promise.all([
        fetchJson<any[]>('/api/activities'),
        fetchJson<any[]>('/api/messages')
      ]);

      const formattedMessages: ActivityItem[] = msgs.map((m: any) => ({
        id: m.id,
        user_id: m.sender_id,
        action: 'a envoyé un message',
        target: '',
        timestamp: m.timestamp,
        category: 'Messages',
        type: 'message',
        content: m.content,
        attachments: m.file_url ? [m.file_url] : []
      }));
      
      const allItems = [...acts, ...formattedMessages].map(item => {
        const user = allUsers.find(u => u.id === item.user_id);
        return {
          ...item,
          user: user ? { name: user.name, avatar: user.avatar || '' } : item.user
        };
      });

      setActivities(allItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    } catch (err) {
      console.error('Activity feed fetch failed:', err);
    }
  };

  useEffect(() => {
    if (allUsers.length > 0) {
      fetchFeed();
    }
  }, [allUsers]);

  const handleSendMessage = async (fileUrl?: string) => {
    if (!message.trim() && !fileUrl) return;
    if (!currentUser) return;
    
    const timestamp = new Date().toISOString();
    const newMessage = {
      id: `msg-${Date.now()}`,
      sender_id: currentUser.id,
      content: message,
      type: fileUrl ? 'file' : 'text',
      file_url: fileUrl,
      timestamp
    };

    // Optimistic update
    const optimisticActivity: ActivityItem = {
      id: newMessage.id,
      user_id: currentUser.id,
      user: { name: currentUser.name, avatar: currentUser.avatar || '' },
      action: 'a envoyé un message',
      target: '',
      timestamp,
      category: 'Messages',
      type: 'message',
      content: message,
      attachments: fileUrl ? [fileUrl] : []
    };

    setActivities(prev => [optimisticActivity, ...prev]);
    setMessage('');

    try {
      await fetchJson('/api/messages', {
        method: 'POST',
        body: JSON.stringify(newMessage)
      });
      
      const mentions = message.match(/@(\w+)/g);
      if (mentions) {
        for (const mention of mentions) {
          const userId = mention.substring(1);
          await fetch('/api/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: `notif-${Date.now()}`,
              user_id: userId,
              content: `Vous avez été mentionné par ${currentUser.name}: ${message}`,
              timestamp: new Date().toISOString()
            })
          });
        }
      }
      
      // Re-fetch to sync with server (optional, but good for consistency)
      // fetchFeed();
    } catch (err) {
      console.error(err);
      // Rollback optimistic update if needed
      fetchFeed();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const { file_url } = await res.json();
      handleSendMessage(file_url);
    } catch (err) {
      console.error(err);
    }
  };

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
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="flex justify-between items-center mt-2">
          <div className="flex gap-2 text-zinc-500">
            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
            <IconPaperclip size={18} className="cursor-pointer" onClick={() => fileInputRef.current?.click()} />
            <IconLink size={18} />
            <IconAlignLeft size={18} />
          </div>
          <button 
            onClick={() => handleSendMessage()}
            className="flex items-center gap-1 bg-blue-900 text-white px-4 py-1.5 rounded-full text-sm font-medium"
          >
            Partagez <IconChevronDown size={16} />
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {activities.map(activity => (
          <div key={activity.id} className="flex gap-3">
            <img src={activity.user?.avatar || "https://picsum.photos/seed/default/32/32"} alt={activity.user?.name || 'User'} className="w-10 h-10 rounded-full" />
            <div className="flex-1">
              <p className="text-sm">
                <span className="font-bold text-blue-600">{activity.user?.name || 'Unknown'}</span> {activity.action}
              </p>
              {activity.target && <p className="font-bold text-zinc-900 dark:text-zinc-100">{activity.target}</p>}
              {activity.content && <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-1">{activity.content}</p>}
              <p className="text-xs text-zinc-500 mt-1">{new Date(activity.timestamp).toLocaleDateString()} · <span className="text-green-600">{activity.category}</span></p>
              {activity.attachments && activity.attachments.length > 0 && (
                <div className="mt-2">
                  {activity.attachments.map(url => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-blue-600 hover:underline text-sm">
                      <IconFileText size={16} /> {url.split('/').pop()}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
