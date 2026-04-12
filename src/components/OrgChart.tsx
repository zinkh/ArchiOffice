import * as React from 'react';
import { cn } from '../lib/utils';

export interface OrgNode {
  id: string;
  name: string;
  title: string;
  department: string;
  avatarUrl?: string;
  salary?: string; // Added for the "salaries detailed" requirement
  children?: OrgNode[];
}

interface OrgNodeProps {
  node: OrgNode;
}

const OrgNodeCard: React.FC<OrgNodeProps> = ({ node }) => {
  const getDeptColor = (dept: string) => {
    switch (dept.toLowerCase()) {
      case 'engineering':
      case 'technique':
        return 'bg-blue-500';
      case 'design':
      case 'architecture':
        return 'bg-purple-500';
      case 'sales':
      case 'commercial':
        return 'bg-green-500';
      case 'management':
      case 'direction':
        return 'bg-zinc-800';
      default:
        return 'bg-zinc-400';
    }
  };

  const getDeptBadgeColor = (dept: string) => {
    switch (dept.toLowerCase()) {
      case 'engineering':
      case 'technique':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'design':
      case 'architecture':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
      case 'sales':
      case 'commercial':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'management':
      case 'direction':
        return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
      default:
        return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400';
    }
  };

  const initials = node.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  return (
    <div className={cn(
      "w-48 p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-md transition-all hover:shadow-lg hover:border-blue-500/50 group cursor-default"
    )}>
      <div className="flex flex-col items-center text-center space-y-2">
        {/* Avatar */}
        <div className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm",
          getDeptColor(node.department)
        )}>
          {node.avatarUrl ? (
            <img 
              src={node.avatarUrl} 
              alt={node.name} 
              className="w-full h-full rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            initials
          )}
        </div>

        {/* Info */}
        <div className="space-y-0.5">
          <h4 className="font-bold text-zinc-900 dark:text-white text-sm truncate w-full">
            {node.name}
          </h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate w-full">
            {node.title}
          </p>
        </div>

        {/* Department Badge */}
        <span className={cn(
          "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
          getDeptBadgeColor(node.department)
        )}>
          {node.department}
        </span>

        {/* Salary Detail (if provided) */}
        {node.salary && (
          <div className="pt-2 mt-2 border-t border-zinc-100 dark:border-zinc-800 w-full">
            <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
              {node.salary}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

interface OrgChartProps {
  data: OrgNode;
}

// Custom Tree Implementation to ensure CSS classes match index.css
const CustomTreeNode: React.FC<{ node: OrgNode }> = ({ node }) => {
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="org-tree-node">
      <div className="org-tree-node-label">
        <OrgNodeCard node={node} />
      </div>
      {hasChildren && (
        <div className="org-tree-node-children">
          {node.children!.map((child) => (
            <CustomTreeNode key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
};

export const OrgChart: React.FC<OrgChartProps> = ({ data }) => {
  return (
    <div className="w-full overflow-x-auto pb-12 pt-4 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800 text-center">
      <div className="inline-block min-w-full align-middle py-4">
        <CustomTreeNode node={data} />
      </div>
    </div>
  );
};

// Mock Data Generation
export const mockOrgData: OrgNode = {
  id: '1',
  name: 'Alexandre Dupont',
  title: 'CEO & Founder',
  department: 'Management',
  salary: '€150,000 / year',
  children: [
    {
      id: '2',
      name: 'Sarah Miller',
      title: 'Head of Engineering',
      department: 'Engineering',
      salary: '€110,000 / year',
      children: [
        {
          id: '5',
          name: 'James Wilson',
          title: 'Senior Developer',
          department: 'Engineering',
          salary: '€85,000 / year',
        },
        {
          id: '6',
          name: 'Elena Rodriguez',
          title: 'Frontend Engineer',
          department: 'Engineering',
          salary: '€70,000 / year',
        }
      ]
    },
    {
      id: '3',
      name: 'Thomas Wright',
      title: 'Design Director',
      department: 'Design',
      salary: '€105,000 / year',
      children: [
        {
          id: '7',
          name: 'Lisa Chen',
          title: 'Senior Architect',
          department: 'Design',
          salary: '€80,000 / year',
        },
        {
          id: '8',
          name: 'Marc Lefebvre',
          title: 'BIM Modeler',
          department: 'Design',
          salary: '€65,000 / year',
        }
      ]
    },
    {
      id: '4',
      name: 'Emma Davis',
      title: 'Sales Manager',
      department: 'Sales',
      salary: '€95,000 / year',
      children: [
        {
          id: '9',
          name: 'Robert Brown',
          title: 'Account Executive',
          department: 'Sales',
          salary: '€60,000 / year',
        }
      ]
    }
  ]
};

export default OrgChart;
