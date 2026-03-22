import { useState, useEffect, useRef } from 'react';
import { IconFile, IconPlus, IconHistory, IconDownload, IconTrash, IconX, IconUpload } from '@tabler/icons-react';
import { Document, Project } from '../types';
import { useUser } from '../UserContext';

export default function Documents() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('General');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { currentUser } = useUser();

  const handleDelete = async (id: string) => {
    console.log('Delete clicked for:', id);
    if (!confirm('Are you sure you want to delete this document?')) return;
    try {
      console.log('About to fetch DELETE for:', id);
      const response = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      console.log('Delete response status:', response.status);
      if (response.ok) {
        fetch('/api/documents').then(res => res.json()).then(setDocuments);
      } else {
        const errorText = await response.text();
        console.error('Delete failed:', response.status, errorText);
        alert(`Failed to delete document: ${response.status} ${errorText}`);
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      alert('Error deleting document: ' + error);
    }
  };

  const handleUpdate = async (id: string) => {
    console.log('Update clicked for:', id);
    const name = prompt('Enter new name:');
    if (!name) return;
    try {
      console.log('About to fetch PUT for:', id);
      const response = await fetch(`/api/documents/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category: 'General', description: '' }),
      });
      console.log('Update response status:', response.status);
      if (response.ok) {
        fetch('/api/documents').then(res => res.json()).then(setDocuments);
      } else {
        const errorText = await response.text();
        console.error('Update failed:', response.status, errorText);
        alert(`Failed to update document: ${response.status} ${errorText}`);
      }
    } catch (error) {
      console.error('Error updating document:', error);
      alert('Error updating document: ' + error);
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('project_id', selectedProject);
    formData.append('name', selectedFile.name);
    formData.append('category', selectedCategory);
    formData.append('description', '');
    formData.append('uploaded_by', currentUser?.name || 'Unknown');

    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      });
      if (response.ok) {
        fetch('/api/documents').then(res => res.json()).then(setDocuments);
        setIsModalOpen(false);
        setSelectedFile(null);
      } else {
        alert('Failed to upload document');
      }
    } catch (error) {
      console.error('Error uploading document:', error);
      alert('Error uploading document');
    }
  };

  useEffect(() => {
    fetch('/api/projects').then(res => res.json()).then(setProjects);
    fetch('/api/documents').then(res => res.json()).then(setDocuments);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Documents</h1>
        <div className="flex flex-col items-end gap-1">
          <p className="text-xs text-zinc-500">Allowed: All file types</p>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700"
          >
            <IconPlus size={18} /> Upload Document
          </button>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl w-full max-w-md space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">Upload Document</h2>
              <button onClick={() => setIsModalOpen(false)}><IconX /></button>
            </div>
            <select className="w-full p-2 rounded-xl border" onChange={(e) => setSelectedProject(e.target.value)} value={selectedProject}>
              <option value="">Select Project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="w-full p-2 rounded-xl border" onChange={(e) => setSelectedCategory(e.target.value)} value={selectedCategory}>
              <option value="General">General</option>
              <option value="Contract">Contract</option>
              <option value="Plan">Plan</option>
            </select>
            <div 
              className="border-2 border-dashed border-zinc-300 rounded-xl p-8 text-center cursor-pointer"
              onDrop={(e) => { e.preventDefault(); setSelectedFile(e.dataTransfer.files[0]); }}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedFile ? selectedFile.name : 'Drop file here or click to select'}
              <input 
                type="file" 
                className="hidden" 
                ref={fileInputRef}
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} 
              />
            </div>
            <button onClick={handleFileUpload} className="w-full py-2 bg-blue-600 text-white rounded-xl font-bold">Upload</button>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-6 py-4">Preview</th>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Project</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Version</th>
                <th className="px-6 py-4">Uploaded At</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4">
                    {doc.file_url.match(/\.(jpg|jpeg|png|gif)$/i) ? (
                      <img src={doc.file_url} alt={doc.name} className="w-10 h-10 object-cover rounded-lg" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 rounded-lg text-zinc-500">
                        <IconFile size={20} />
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 font-bold text-zinc-900 dark:text-white" title={doc.name}>
                    {doc.name.length > 10 ? `${doc.name.substring(0, 10)}...` : doc.name}
                  </td>
                  <td className="px-6 py-4 text-zinc-500">{projects.find(p => p.id === doc.project_id)?.name || 'N/A'}</td>
                  <td className="px-6 py-4 text-zinc-500">{doc.category}</td>
                  <td className="px-6 py-4 text-zinc-500">v{doc.version}</td>
                  <td className="px-6 py-4 text-zinc-500">{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 flex items-center gap-2">
                    <button className="p-2 text-zinc-400 hover:text-blue-500" onClick={() => handleUpdate(doc.id)}><IconHistory size={16} /></button>
                    <button className="p-2 text-zinc-400 hover:text-blue-500" onClick={() => window.open(doc.file_url, '_blank')}><IconDownload size={16} /></button>
                    <button className="p-2 text-zinc-400 hover:text-red-500" onClick={() => handleDelete(doc.id)}><IconTrash size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
