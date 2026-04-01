import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  BookOpen,
  ShoppingCart,
  Users,
  Store,
  ChevronLeft,
  ChevronRight,
  X,
  Box
} from 'lucide-react';

export type UserRole = 'admin' | 'vendor';

interface SidebarNavigationProps {
  userRole: UserRole;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  roles: UserRole[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, roles: ['admin', 'vendor'] },
  { label: 'Catalog (PIM)', path: '/catalog', icon: BookOpen, roles: ['admin', 'vendor'] },
  { label: 'Orders (OMS)', path: '/orders', icon: ShoppingCart, roles: ['admin', 'vendor'] },
  { label: 'Customers & B2B', path: '/customers', icon: Users, roles: ['admin', 'vendor'] },
  { label: 'Vendors & Payouts', path: '/vendors', icon: Store, roles: ['admin'] },
];

export function SidebarNavigation({
  userRole,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
}: SidebarNavigationProps) {
  const location = useLocation();
  const pathname = location.pathname;

  const NavContent = ({ isMobile = false }: { isMobile?: boolean }) => {
    const collapsed = isMobile ? false : isCollapsed;

    return (
      <div className="flex flex-col h-full">
        {/* Logo Area */}
        <div className="h-16 flex items-center px-4 border-b border-zinc-200 shrink-0 justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 bg-blue-600 rounded-md shrink-0 flex items-center justify-center text-white">
              <Box className="w-5 h-5" />
            </div>
            <AnimatePresence mode="wait">
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  className="font-bold text-lg text-zinc-900 whitespace-nowrap"
                >
                  AeroCommerce
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          {isMobile && (
            <button
              onClick={onCloseMobile}
              className="p-1.5 text-zinc-500 hover:bg-zinc-200 rounded-md transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 py-4 flex flex-col overflow-y-auto overflow-x-hidden">
          {navItems
            .filter((item) => item.roles.includes(userRole))
            .map((item) => {
              const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => isMobile && onCloseMobile()}
                  className={`
                    flex items-center px-4 py-3 transition-colors relative group
                    ${
                      isActive
                        ? 'bg-blue-50 text-blue-600 border-r-4 border-blue-600'
                        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 border-r-4 border-transparent'
                    }
                  `}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon
                    className={`w-5 h-5 shrink-0 transition-colors ${
                      isActive ? 'text-blue-600' : 'text-zinc-500 group-hover:text-zinc-900'
                    }`}
                  />
                  <AnimatePresence mode="wait">
                    {!collapsed && (
                      <motion.span
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: 'auto' }}
                        exit={{ opacity: 0, width: 0 }}
                        className="ml-3 font-medium whitespace-nowrap"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Link>
              );
            })}
        </nav>

        {/* Collapse Toggle (Desktop Only) */}
        {!isMobile && (
          <div className="p-4 border-t border-zinc-200 shrink-0 flex justify-center">
            <button
              onClick={onToggleCollapse}
              className="p-2 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 rounded-md transition-colors w-full flex justify-center"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile Overlay & Drawer */}
      <AnimatePresence>
        {isMobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-zinc-900/50 z-40 md:hidden"
              onClick={onCloseMobile}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              className="fixed inset-y-0 left-0 z-50 w-64 bg-zinc-100 border-r border-zinc-200 flex flex-col md:hidden shadow-xl"
            >
              <NavContent isMobile={true} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Collapsible Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: isCollapsed ? '4rem' : '16rem' }}
        transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
        className="hidden md:flex flex-col h-full bg-zinc-100 border-r border-zinc-200 z-10 overflow-hidden shrink-0"
      >
        <NavContent isMobile={false} />
      </motion.aside>
    </>
  );
}
