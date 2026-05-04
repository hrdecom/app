import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Loader2,
  PackageCheck,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  User as UserIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth';
import { listProducts } from '@/lib/products';
import type { ProductListItem } from '@/types/product';
import { TaskItem } from '@/components/integrator/TaskItem';
import { WorkspaceView } from '@/components/integrator/WorkspaceView';
import { cn } from '@/lib/utils';

type Group = 'todo' | 'in_progress' | 'done';

export default function IntegratorPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [todo, setTodo] = useState<ProductListItem[]>([]);
  const [inProgress, setInProgress] = useState<ProductListItem[]>([]);
  const [done, setDone] = useState<ProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<number | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState<Record<Group, boolean>>({
    todo: true,
    in_progress: true,
    done: false,
  });
  // P26-9 — collapsible task sidebar so the Personalizer (and other
  // tools) get more room when the merchant is on a smaller laptop.
  // Persists to localStorage so the choice survives reloads.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('integrator.sidebarCollapsed') === '1'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('integrator.sidebarCollapsed', sidebarCollapsed ? '1' : '0'); }
    catch { /* */ }
  }, [sidebarCollapsed]);
  // P26-11 — auto-collapse on every resize below the threshold, not
  // just on first load. This is the actual user-reported behaviour:
  // when they shrink the window, the sidebar should retract FIRST so
  // the preview / canvas stays usable. They can always manually
  // expand even on a narrow screen via the toggle button.
  useEffect(() => {
    const COLLAPSE_BELOW = 1280;
    let lastWidth = window.innerWidth;
    const onResize = () => {
      const w = window.innerWidth;
      // Crossing threshold downward -> auto-collapse.
      if (lastWidth >= COLLAPSE_BELOW && w < COLLAPSE_BELOW) {
        setSidebarCollapsed(true);
      }
      // Crossing threshold upward -> auto-expand.
      else if (lastWidth < COLLAPSE_BELOW && w >= COLLAPSE_BELOW) {
        setSidebarCollapsed(false);
      }
      lastWidth = w;
    };
    // Initial pass so a small viewport at first load also collapses.
    if (window.innerWidth < COLLAPSE_BELOW) setSidebarCollapsed(true);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isAdmin = user?.role === 'admin';

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // FIX 32 — "Done" no longer scopes by `assigned_to=me` and no
      // longer pins the status to `pushed_to_shopify` only. Both of
      // those changes were causing shipped products to vanish from
      // the integrator's Done tab the moment an ads-creator clicked
      // "Work on it" (which re-assigns the product AND moves the
      // status to `ads_in_progress`). We now query by `pushed_by=me`
      // (= integrator did the push, sourced from workflow_events on
      // the backend) and accept every post-push status. To Do / In
      // Progress keep the assigned_to=me scope because those are
      // active-work buckets.
      const activeScope: any = isAdmin ? {} : { assigned_to: 'me' };
      const doneScope: any = isAdmin ? {} : { pushed_by: 'me' };
      const [t, p, d] = await Promise.all([
        listProducts({ status: 'validated_todo', ...activeScope }),
        listProducts({ status: 'in_progress', ...activeScope }),
        listProducts({
          status: 'pushed_to_shopify,ads_in_progress,ads_ready,published',
          ...doneScope,
        }),
      ]);
      setTodo(t.items);
      setInProgress(p.items);
      setDone(d.items);
    } catch (e) {
      console.error('Failed to load integrator tasks', e);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadAll();
  }, [loadAll, refreshKey]);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  function GroupHeader({
    group,
    label,
    icon: Icon,
    count,
  }: {
    group: Group;
    label: string;
    icon: any;
    count: number;
  }) {
    const isOpen = open[group];
    return (
      <button
        onClick={() => setOpen({ ...open, [group]: !isOpen })}
        className="flex items-center justify-between w-full px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-2">
          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Icon className="h-4 w-4" />
          {label}
        </span>
        <Badge variant="outline" className="font-normal">
          {count}
        </Badge>
      </button>
    );
  }

  const renderGroup = (group: Group, items: ProductListItem[]) =>
    open[group] && (
      <div className="space-y-1 pb-2">
        {items.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Nothing here.</p>
        ) : (
          items.map((p) => (
            <TaskItem
              key={p.id}
              product={p}
              active={activeId === p.id}
              onSelect={() => setActiveId(p.id)}
            />
          ))
        )}
      </div>
    );

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* P26-9 — Collapsible sidebar. When collapsed, only a slim
          icon column remains so the canvas / Personalizer reclaims
          screen real-estate. The toggle button is always visible at
          the top. The choice is persisted in localStorage. */}
      <aside
        className={cn(
          'hidden md:flex md:flex-col shrink-0 border-r border-gray-200 bg-white transition-[width] duration-200',
          sidebarCollapsed ? 'w-12' : 'w-72 lg:w-80',
        )}
      >
        <div className={cn(
          'border-b border-gray-200 flex items-center justify-between',
          sidebarCollapsed ? 'p-2 flex-col gap-1' : 'p-4',
        )}>
          {!sidebarCollapsed && (
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                {isAdmin ? 'All Tasks' : 'My Tasks'}
              </h1>
              {isAdmin && (
                <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">
                  Admin view
                </p>
              )}
            </div>
          )}
          <div className={cn('flex items-center gap-1', sidebarCollapsed && 'flex-col')}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSidebarCollapsed((c) => !c);
                try { localStorage.setItem('integrator.sidebarCollapsed.userSet', '1'); } catch { /* */ }
              }}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed
                ? <PanelLeftOpen className="h-4 w-4" />
                : <PanelLeftClose className="h-4 w-4" />}
            </Button>
            {!sidebarCollapsed && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={refresh}
                  disabled={loading}
                  aria-label="Refresh"
                >
                  <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" aria-label="Account">
                      <UserIcon className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <div className="px-2 py-1.5 text-sm">
                      <p className="font-medium">{user?.name || user?.email}</p>
                      <p className="text-xs text-muted-foreground">{user?.role}</p>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout}>Logout</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>

        {!sidebarCollapsed && (
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            <div>
              <GroupHeader group="todo" label="To Do" icon={CheckCircle2} count={todo.length} />
              {renderGroup('todo', todo)}
            </div>
            <div>
              <GroupHeader
                group="in_progress"
                label="In Progress"
                icon={Loader2}
                count={inProgress.length}
              />
              {renderGroup('in_progress', inProgress)}
            </div>
            <div>
              <GroupHeader group="done" label="Done" icon={PackageCheck} count={done.length} />
              {renderGroup('done', done)}
            </div>
          </div>
        )}
        {/* When collapsed, show tiny status pills as a quick visual
            cue without the full list. Click to expand. */}
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={() => {
              setSidebarCollapsed(false);
              try { localStorage.setItem('integrator.sidebarCollapsed.userSet', '1'); } catch { /* */ }
            }}
            className="flex-1 flex flex-col items-center justify-start gap-2 py-3 hover:bg-gray-50 transition-colors"
            title="Click to expand"
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground rotate-180" style={{ writingMode: 'vertical-rl' }}>
              Tasks
            </div>
            <div className="flex flex-col items-center gap-1.5 mt-1">
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {todo.length}
              </Badge>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700">
                {inProgress.length}
              </Badge>
            </div>
          </button>
        )}
      </aside>

      {/* Mobile: product list is a top bar summary — full drawer comes later */}
      <div className="md:hidden fixed top-0 inset-x-0 z-20 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">My Tasks</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <UserIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleLogout}>Logout</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main */}
      <main className="flex-1 overflow-y-auto md:mt-0 mt-14">
        {activeId ? (
          <WorkspaceView productId={activeId} onUpdated={refresh} onBack={() => setActiveId(undefined)} />
        ) : (
          <div className="h-full flex items-center justify-center p-8">
            <div className="max-w-md text-center space-y-2">
              <PackageCheck className="h-10 w-10 mx-auto text-muted-foreground" />
              <h2 className="text-lg font-medium tracking-tight">Pick a task from the sidebar</h2>
              <p className="text-sm text-muted-foreground">
                Select a product to open its workspace. Your "To Do" list shows everything an admin has
                assigned to you.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
