import * as React from 'react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { IconSwitchHorizontal } from '@tabler/icons-react';
import { useUser } from '../UserContext';
import { cn } from '../lib/utils';

export function UserSwitcher() {
  const { currentUser, setCurrentUser, allUsers } = useUser();
  const [isOpen, setIsOpen] = useState(false);

  if (allUsers.length <= 1) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 rounded-full shadow-lg hover:scale-105 transition-transform"
      >
        <IconSwitchHorizontal size={18} />
        <span className="text-sm font-medium">Switch User</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="absolute bottom-16 right-0 w-64 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl z-50 overflow-hidden"
            >
              <div className="p-3 border-b border-zinc-100 dark:border-zinc-800">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">Select User (Testing)</p>
                <div className="space-y-1">
                  {allUsers.map(user => (
                    <button
                      key={user.id}
                      onClick={() => {
                        setCurrentUser(user);
                        setIsOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 p-2 rounded-lg text-sm transition-colors",
                        currentUser?.id === user.id
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-500"
                          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      )}
                    >
                      <div className="w-6 h-6 rounded-full overflow-hidden">
                        <img src={user.avatar || "https://picsum.photos/seed/default/32/32"} alt={user.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="text-left">
                        <p className="font-medium leading-none">{user.name}</p>
                        <p className="text-[10px] opacity-70 uppercase">{user.system_role}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
