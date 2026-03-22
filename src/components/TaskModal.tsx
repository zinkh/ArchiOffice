import { useState, useEffect } from 'react';
import { Task } from '../types';

interface TaskModalProps {
  task: Task;
  allTasks: Task[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Task) => void;
}

export default function TaskModal({ task, allTasks, isOpen, onClose, onSave }: TaskModalProps) {
  const [formData, setFormData] = useState<Task>({
    ...task,
    title: task.title || '',
    start_date: task.start_date || '',
    end_date: task.end_date || '',
    progress: task.progress || 0,
    dependencies: task.dependencies || []
  });

  useEffect(() => {
    setFormData({
      ...task,
      title: task.title || '',
      start_date: task.start_date || '',
      end_date: task.end_date || '',
      progress: task.progress || 0,
      dependencies: task.dependencies || []
    });
  }, [task]);

  if (!isOpen) return null;

  const projectTasks = allTasks.filter(t => t.project_id === task.project_id && t.id !== task.id);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-800 p-6 rounded-lg w-96 shadow-xl">
        <h2 className="text-lg font-bold mb-4 text-zinc-900 dark:text-white">Edit Task</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Title</label>
            <input 
              type="text" 
              value={formData.title} 
              onChange={e => setFormData({ ...formData, title: e.target.value })}
              className="w-full p-2 border border-zinc-300 rounded mt-1 dark:bg-zinc-700 dark:border-zinc-600 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Start Date</label>
            <input 
              type="date" 
              value={formData.start_date} 
              onChange={e => setFormData({ ...formData, start_date: e.target.value })}
              className="w-full p-2 border border-zinc-300 rounded mt-1 dark:bg-zinc-700 dark:border-zinc-600 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">End Date</label>
            <input 
              type="date" 
              value={formData.end_date} 
              onChange={e => setFormData({ ...formData, end_date: e.target.value })}
              className="w-full p-2 border border-zinc-300 rounded mt-1 dark:bg-zinc-700 dark:border-zinc-600 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Progress (%)</label>
            <input 
              type="number" 
              value={formData.progress} 
              onChange={e => setFormData({ ...formData, progress: parseInt(e.target.value) })}
              className="w-full p-2 border border-zinc-300 rounded mt-1 dark:bg-zinc-700 dark:border-zinc-600 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Dependencies</label>
            <div className="space-y-1 mt-1">
              {projectTasks.map(t => (
                <label key={t.id} className="flex items-center text-sm text-zinc-700 dark:text-zinc-300">
                  <input 
                    type="checkbox" 
                    checked={formData.dependencies.includes(t.id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setFormData({ ...formData, dependencies: [...formData.dependencies, t.id] });
                      } else {
                        setFormData({ ...formData, dependencies: formData.dependencies.filter(id => id !== t.id) });
                      }
                    }}
                    className="mr-2"
                  />
                  {t.title}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 bg-zinc-200 rounded text-zinc-800 dark:bg-zinc-700 dark:text-white">Cancel</button>
          <button onClick={() => onSave(formData)} className="px-4 py-2 bg-blue-600 text-white rounded">Save</button>
        </div>
      </div>
    </div>
  );
}
