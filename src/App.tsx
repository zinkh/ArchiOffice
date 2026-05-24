import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate, Navigate, Outlet } from 'react-router-dom';
import {
  IconSearch,
  IconBell,
  IconSettings,
  IconMenu2,
  IconSun,
  IconMoon,
  IconCloudOff,
  IconCloudUpload,
  IconCheck,
  IconLogout,
} from '@tabler/icons-react';
import { ArchiOfficeLogo } from './components/ArchiOfficeLogo';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { useTranslation } from 'react-i18next';
import { ThemeProvider, useTheme } from './components/theme-provider';
import { UserProvider, useUser } from './UserContext';
import { Sidebar, NAV_ITEMS } from './components/Sidebar';
import './i18n';

// Pages
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Proposals from './pages/Proposals';
import Invoices from './pages/Invoices';
import Tenders from './pages/Tenders';
import Specifications from './pages/Specifications';
import Team from './pages/Team';
import Gantt from './pages/Gantt';
import Contacts from './pages/Contacts';
import ProjectTemplates from './pages/ProjectTemplates';
import ProjectDetail from './pages/ProjectDetail';
import References from './pages/References';
import Documents from './pages/Documents';
import Settings from './pages/Settings';
import Billing from './pages/Billing';
import TenderDetail from './pages/TenderDetail';
import ProposalModule from './components/ProposalModule';
import Login from './pages/Login';
import Register from './pages/Register';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfUse from './pages/TermsOfUse';

function SyncStatus() {
  const { t } = useTranslation();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOnline) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded text-[10px] font-bold uppercase tracking-wider border border-amber-200 dark:border-amber-800/50">
        <IconCloudOff size={14} />
        {t('sync_offline')}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded text-[10px] font-bold uppercase tracking-wider border border-emerald-200 dark:border-emerald-800/50">
      <IconCheck size={14} />
      {t('sync_online')}
    </div>
  );
}

function Header() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { currentUser, headerTitle, setHeaderTitle, signOut } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const item = NAV_ITEMS.find(i => i.path === location.pathname);
    if (item) {
      setHeaderTitle(t(item.name));
    }
  }, [location.pathname, t, setHeaderTitle]);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-xl shadow-sm">
      <div className="px-4 h-16 flex items-center justify-between">
        <div className="md:hidden flex items-center gap-4">
          <button
            className="p-2 text-zinc-500"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            <IconMenu2 size={24} />
          </button>
          <Link to="/" className="flex items-center gap-2 text-zinc-900 dark:text-white font-bold text-xl tracking-tight">
            <ArchiOfficeLogo size={32} />
            {t('app_name')}
          </Link>
        </div>
        <div className="hidden md:flex items-center gap-4">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">{headerTitle}</h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden lg:flex">
            <SyncStatus />
          </div>
          <div className="hidden md:flex relative">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
            <input
              type="text"
              placeholder={t('search_placeholder')}
              className="pl-9 pr-4 py-1.5 bg-zinc-100 dark:bg-zinc-800 border-transparent focus:bg-white dark:focus:bg-zinc-900 border focus:border-blue-500 rounded text-sm w-64 transition-all outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500"
            />
          </div>

          <div className="flex items-center gap-0 sm:gap-2">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title={theme === 'dark' ? t('theme_light') : t('theme_dark')}
            >
              {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </button>
            <button
              onClick={() => navigate('/notifications')}
              className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 relative"
            >
              <IconBell size={18} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white dark:border-zinc-900" />
            </button>

            <div className="relative ml-0 sm:ml-1">
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 p-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                  <img src={currentUser?.avatar || "https://picsum.photos/seed/arch/32/32"} alt="User" referrerPolicy="no-referrer" />
                </div>
              </button>

              <AnimatePresence>
                {isUserMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 10 }}
                      className="absolute right-0 mt-2 w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden"
                    >
                      <div className="p-3 border-b border-zinc-100 dark:border-zinc-800">
                        <div className="flex items-center gap-3 p-1">
                          <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
                            <img src={currentUser?.avatar || "https://picsum.photos/seed/arch/32/32"} alt={currentUser?.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                          <div className="overflow-hidden">
                            <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{currentUser?.name}</p>
                            <p className="text-xs text-zinc-500 truncate">{currentUser?.email}</p>
                          </div>
                        </div>
                      </div>
                      <div className="p-2">
                        <button
                          onClick={() => {
                            navigate('/settings');
                            setIsUserMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-2 p-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                        >
                          <IconSettings size={16} />
                          {t('account_settings')}
                        </button>
                        <button
                          onClick={() => {
                            signOut();
                            setIsUserMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-2 p-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                          <IconLogout size={16} />
                          Déconnexion
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden"
          >
            <nav className="flex flex-col p-4 gap-2">
              {NAV_ITEMS.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                      isActive
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-500"
                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200"
                    )}
                  >
                    <item.icon size={20} />
                    <span>{t(item.name)}</span>
                  </Link>
                );
              })}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function ProtectedLayout() {
  const { currentUser, isLoading } = useUser();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#050505]">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-[#050505] text-zinc-900 dark:text-zinc-100 font-sans transition-colors duration-300 overflow-x-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col w-full overflow-x-hidden">
        <Header />

        <main className="container mx-auto px-4 py-8 flex-1">
          <Outlet />
        </main>

        <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-xl mt-auto py-8">
          <div className="container mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
            <div>{t('footer_rights')}</div>
            <div className="flex gap-6">
              <a href="#" className="hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors">{t('footer_privacy')}</a>
              <a href="#" className="hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors">{t('footer_terms')}</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <UserProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfUse />} />
            <Route element={<ProtectedLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/references" element={<References />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/proposals" element={<Proposals />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/tenders" element={<Tenders />} />
              <Route path="/tenders/:id" element={<TenderDetail />} />
              <Route path="/specifications" element={<Specifications />} />
              <Route path="/specifications/:specId" element={<Specifications />} />
              <Route path="/team" element={<Team />} />
              <Route path="/gantt" element={<Gantt />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/templates" element={<ProjectTemplates />} />
              <Route path="/proposal-generator" element={<ProposalModule />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/billing" element={<Billing />} />
            </Route>
          </Routes>
        </Router>
      </UserProvider>
    </ThemeProvider>
  );
}
