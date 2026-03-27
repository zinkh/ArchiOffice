import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBell, IconUser } from '@tabler/icons-react';

interface Notification {
  id: string;
  user_id: string;
  content: string;
  timestamp: string;
  read: number;
}

export default function Notifications() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    // Assuming current user ID is 't1' for demo purposes
    fetch('/api/notifications/t1')
      .then(res => res.json())
      .then(setNotifications)
      .catch(err => console.error(err));
  }, []);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-6">{t('notifications')}</h1>
      <div className="space-y-4">
        {notifications.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400">{t('no_notifications')}</p>
        ) : (
          notifications.map(notif => (
            <div key={notif.id} className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg flex gap-4">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-full text-blue-600 dark:text-blue-400">
                <IconBell size={20} />
              </div>
              <div>
                <p className="text-sm text-zinc-900 dark:text-zinc-100">{notif.content}</p>
                <p className="text-xs text-zinc-500 mt-1">{new Date(notif.timestamp).toLocaleString()}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
