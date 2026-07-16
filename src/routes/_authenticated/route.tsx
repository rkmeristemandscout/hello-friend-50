import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { OrganizationProvider } from "@/hooks/use-current-org";
import { OrgSwitcher } from "@/components/org-switcher";
import { usePermissions } from "@/hooks/use-permissions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { mode: "signin" as const } });
    }
    return { user: data.user };
  },
  component: Layout,
});

function Layout() {
  const { user } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { mode: "signin" as const }, replace: true });
  }

  return (
    <OrganizationProvider>
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-6">
              <Link to="/dashboard" className="font-semibold">Stackly</Link>
              <OrgSwitcher />
              <Nav />
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-muted-foreground sm:inline">{user?.email}</span>
              <Button size="sm" variant="outline" onClick={signOut}>Sign out</Button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">
          <Outlet />
        </main>
      </div>
    </OrganizationProvider>
  );
}

function Nav() {
  const { can, isSuperAdmin } = usePermissions();
  const linkClass =
    "rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground";
  const items: { to: string; label: string; show: boolean }[] = [
    { to: "/dashboard", label: "Dashboard", show: true },
    { to: "/organizations", label: "Organizations", show: true },
    { to: "/teams", label: "Teams", show: can(["team.view", "team.create"]) },
    { to: "/departments", label: "Departments", show: can("department.view") },
    { to: "/invitations", label: "Invitations", show: can("invitation.view") },
    { to: "/roles", label: "Roles", show: can("org.manage_users") || isSuperAdmin },
    { to: "/profile", label: "Profile", show: true },
  ];
  return (
    <nav className="flex gap-1 text-sm">
      {items.filter((i) => i.show).map((i) => (
        <Link
          key={i.to}
          to={i.to}
          className={linkClass}
          activeProps={{ className: "active" }}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
