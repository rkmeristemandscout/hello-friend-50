import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = useSession();

  const orgs = useQuery({
    queryKey: ["my-organizations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("role, organizations:organization_id(id, name, slug, description)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome{user?.user_metadata?.full_name ? `, ${user.user_metadata.full_name}` : ""}
        </h1>
        <p className="mt-1 text-muted-foreground">Your workspaces at a glance.</p>
      </div>

      <section className="rounded-xl border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your organizations</h2>
          <Button asChild size="sm"><Link to="/organizations">Manage</Link></Button>
        </div>
        {orgs.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : orgs.data && orgs.data.length > 0 ? (
          <ul className="mt-4 divide-y">
            {orgs.data.map((m) => {
              const org = m.organizations as { id: string; name: string; slug: string; description: string | null } | null;
              if (!org) return null;
              return (
                <li key={org.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{org.name}</p>
                    <p className="text-xs text-muted-foreground">/{org.slug} · {m.role}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            You aren't in any organizations yet. <Link to="/organizations" className="underline">Create one</Link>.
          </p>
        )}
      </section>
    </div>
  );
}
