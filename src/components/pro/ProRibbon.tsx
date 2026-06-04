import React, { useState } from 'react';

export interface RibbonAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

export interface RibbonGroup {
  label: string;
  actions: RibbonAction[];
}

export interface RibbonTabDef {
  id: string;
  label: string;
  groups: RibbonGroup[];
}

interface ProRibbonProps {
  tabs: RibbonTabDef[];
  defaultTab?: string;
}

export const ProRibbon: React.FC<ProRibbonProps> = ({ tabs, defaultTab }) => {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id || '');
  const currentTab = tabs.find(t => t.id === activeTab) || tabs[0];

  return (
    <div
      className="select-none border-b border-[#9ab0cb] dark:border-zinc-600 shadow-sm"
      style={{ background: 'linear-gradient(to bottom, #e8edf4, #dde4ee)' }}
    >
      {/* Tab strip */}
      <div className="flex items-end pl-2 bg-[#c9d8e8] dark:bg-zinc-800">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 text-xs font-medium rounded-t border border-b-0 transition-colors -mb-px ${
              tab.id === activeTab
                ? 'bg-[#f0f4f8] dark:bg-zinc-700 border-[#9ab0cb] dark:border-zinc-600 text-blue-900 dark:text-blue-300 font-semibold'
                : 'bg-transparent border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-[#d8e4f0] dark:hover:bg-zinc-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Ribbon content */}
      {currentTab && (
        <div
          className="flex items-stretch gap-0 px-2 py-1 min-h-[72px]"
          style={{ background: 'linear-gradient(to bottom, #f5f8fc, #edf1f7)' }}
        >
          {currentTab.groups.map((group, gi) => (
            <React.Fragment key={gi}>
              <div className="flex flex-col min-w-0">
                <div className="flex items-start gap-0.5 flex-1 pt-1 pb-1">
                  {group.actions.map(action => (
                    <button
                      key={action.id}
                      onClick={action.onClick}
                      disabled={action.disabled}
                      title={action.label}
                      className={`
                        flex flex-col items-center justify-start gap-0.5
                        px-1.5 py-1 rounded min-w-[44px] max-w-[60px] h-[52px]
                        text-[10px] border transition-all leading-tight
                        ${action.active
                          ? 'bg-[#cce0f5] dark:bg-blue-900/40 border-blue-400 text-blue-800 dark:text-blue-200'
                          : 'bg-transparent border-transparent hover:bg-[#dce8f8] hover:border-[#aac4dc] text-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600'
                        }
                        disabled:opacity-40 disabled:cursor-not-allowed
                      `}
                    >
                      <span className="flex items-center justify-center mt-1 shrink-0">
                        {action.icon}
                      </span>
                      <span className="text-center break-words leading-tight text-[9px] w-full px-0.5">
                        {action.label}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="text-[9px] text-center text-zinc-500 dark:text-zinc-400 border-t border-[#c0d0e0] dark:border-zinc-600 pt-0.5 px-2">
                  {group.label}
                </div>
              </div>
              {gi < currentTab.groups.length - 1 && (
                <div className="w-px bg-[#b8c8d8] dark:bg-zinc-600 mx-1.5 self-stretch my-1" />
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
