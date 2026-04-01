import React, { useState } from 'react';
import { SidebarNavigation, UserRole } from './SidebarNavigation';
import { Menu, Bell, Search, User } from 'lucide-react';

interface AppShellProps {
  children: React.ReactNode;
  userRole?: UserRole;
}

export function AppShell({ children, userRole = 'admin' }: AppShellProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full bg-white overflow-hidden text-zinc-900 font-sans">
      <SidebarNavigation
        userRole={userRole}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
      />
      
      <div className="flex flex-col flex-1 min-w-0">
        {/* TopHeader */}
        <header className="flex items-center justify-between h-16 px-4 md:px-6 border-b border-zinc-200 bg-white shrink-0 z-10">
          <div className="flex items-center gap-4 flex-1">
            <button
              className="md:hidden p-2 -ml-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 rounded-md transition-colors"
              onClick={() => setIsMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            
            {/* GlobalSearch */}
            <div className="hidden sm:flex items-center max-w-md w-full relative group">
              <Search className="w-4 h-4 absolute left-3 text-zinc-400 group-focus-within:text-blue-600 transition-colors" />
              <input
                type="text"
                placeholder="Search products, orders, or customers..."
                className="w-full pl-9 pr-4 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-md text-zinc-900 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent focus:bg-white transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            {/* NotificationBell */}
            <button 
              className="p-2 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 rounded-full relative transition-colors"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full border-2 border-white"></span>
            </button>
            
            <div className="w-px h-6 bg-zinc-200 hidden md:block"></div>
            
            {/* UserMenu */}
            <button className="flex items-center gap-2 p-1 hover:bg-zinc-100 rounded-md transition-colors text-left">
              <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-semibold text-sm shrink-0">
                {userRole === 'admin' ? 'AD' : 'VN'}
              </div>
              <div className="hidden md:block pr-2">
                <p className="text-sm font-medium text-zinc-900 leading-none">
                  {userRole === 'admin' ? 'Admin Alice' : 'Vendor Vince'}
                </p>
                <p className="text-xs text-zinc-500 mt-1 capitalize leading-none">
                  {userRole}
                </p>
              </div>
            </button>
          </div>
        </header>

        {/* MainContentArea */}
        <main className="flex-1 overflow-y-auto bg-white relative">
          <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
