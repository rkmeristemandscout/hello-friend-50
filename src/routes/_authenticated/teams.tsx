import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { teamSchema, type TeamValues } from "@/lib/auth-schemas";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/teams")({
  component: TeamsPage,
});

function TeamsPage() {
  const { user } = useSession();
  const { currentMembership } = useCurrentOrg();
  const org = currentMembership?.organization;
  const canManageOrg =
    currentMembership?.role === "owner" || currentMembership?.role === "admin";
  const qc = useQueryClient();

  const teams = useQuery({
    enabled: !!org,
    queryKey: ["teams", org?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, slug, description, owner_id, created_at")
        .eq("organization_id", org!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const ids = Array.from(new Set((data ?? []).map((t) => t.owner_id)));
      let owners: Record<string, { full_name: string | null }> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles").select("id, full_name").in("id", ids);
        owners = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
      }
      return (data ?? []).map((t) => ({ ...t, owner: owners[t.owner_id] ?? null }));
    },
  });

  const { register, handleSubmit, reset, formState } = useForm<TeamValues>({
    resolver: zodResolver(teamSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  const create = useMutation({
    mutationFn: async (v: TeamValues) => {
      if (!org || !user) throw new Error("Missing context");
      const { data, error } = await supabase
        .from("teams")
        .insert({
          organization_id: org.id,
          name: v.name,
          slug: v.slug,
          description: v.description || null,
          owner_id: user.id,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Team created");
      reset();
      qc.invalidateQueries({ queryKey: ["teams", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!org) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Select an organization to see its teams.
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="rounded-xl border bg-card p-6 md:col-span-2">
        <h2 className="text-lg font-semibold">Teams in {org.name}</h2>
        {teams.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : teams.data && teams.data.length > 0 ? (
          <ul className="mt-4 divide-y">
            {teams.data.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    /{t.slug} · owner {t.owner?.full_name ?? "unknown"}
                    {t.owner_id === user?.id && (
                      <Badge variant="secondary" className="ml-2">You</Badge>
                    )}
                  </p>
                  {t.description && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-1">{t.description}</p>
                  )}
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/teams/$teamId" params={{ teamId: t.id }}>Open</Link>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No teams yet.</p>
        )}
      </section>

      {canManageOrg && (
        <section className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold">New team</h2>
          <form onSubmit={handleSubmit((v) => create.mutate(v))} className="mt-4 space-y-4">
            <div>
              <Label htmlFor="team-name">Name</Label>
              <Input id="team-name" {...register("name")} />
              {formState.errors.name && <p className="mt-1 text-xs text-destructive">{formState.errors.name.message}</p>}
            </div>
            <div>
              <Label htmlFor="team-slug">Slug</Label>
              <Input id="team-slug" placeholder="growth" {...register("slug")} />
              {formState.errors.slug && <p className="mt-1 text-xs text-destructive">{formState.errors.slug.message}</p>}
            </div>
            <div>
              <Label htmlFor="team-desc">Description</Label>
              <Textarea id="team-desc" rows={3} {...register("description")} />
            </div>
            <Button type="submit" disabled={create.isPending} className="w-full">
              {create.isPending ? "Creating…" : "Create team"}
            </Button>
          </form>
        </section>
      )}
    </div>
  );
}
