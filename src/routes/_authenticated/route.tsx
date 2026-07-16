import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { OrganizationProvider } from "@/hooks/use-current-org";
import { OrgSwitcher } from "@/components/org-switcher";

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
              <nav className="flex gap-1 text-sm">
                <Link
                  to="/dashboard"
                  className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
                  activeProps={{ className: "active" }}
                >
                  Dashboard
                </Link>
                <Link
                  to="/organizations"
                  className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
                  activeProps={{ className: "active" }}
                >
                  Organizations
                </Link>
                <Link
                  to="/teams"
                  className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
                  activeProps={{ className: "active" }}
                >
                  Teams
                </Link>
                <Link
                  to="/departments"
                  className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
                  activeProps={{ className: "active" }}
                >
                  Departments
                </Link>
                <Link
                  to="/invitations"
                  className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
                  activeProps={{ className: "active" }}
                >
                  Invitations
                </Link>
                <Link
                  to="/profile"
                  className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
                  activeProps={{ className: "active" }}
                >
                  Profile
                </Link>
              </nav>
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
