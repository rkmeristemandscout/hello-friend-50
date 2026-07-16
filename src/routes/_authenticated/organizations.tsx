import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { orgSchema, type OrgValues } from "@/lib/auth-schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/organizations")({
  component: OrganizationsPage,
});

function OrganizationsPage() {
  const qc = useQueryClient();
  const { register, handleSubmit, formState, reset } = useForm<OrgValues>({
    resolver: zodResolver(orgSchema),
  });

  const orgs = useQuery({
    queryKey: ["my-organizations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("role, organizations:organization_id(id, name, slug, description)");
      if (error) throw error;
      return data;
    },
  });

  const createOrg = useMutation({
    mutationFn: async (v: OrgValues) => {
      const { data, error } = await supabase.rpc("create_organization", {
        _name: v.name,
        _slug: v.slug,
        _description: v.description || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Organization created");
      reset();
      qc.invalidateQueries({ queryKey: ["my-organizations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Create a new organization</h2>
        <form
          onSubmit={handleSubmit((v) => createOrg.mutate(v))}
          className="mt-4 space-y-4"
        >
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...register("name")} />
            {formState.errors.name && <p className="mt-1 text-xs text-destructive">{formState.errors.name.message}</p>}
          </div>
          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" placeholder="acme-inc" {...register("slug")} />
            {formState.errors.slug && <p className="mt-1 text-xs text-destructive">{formState.errors.slug.message}</p>}
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={3} {...register("description")} />
          </div>
          <Button type="submit" disabled={createOrg.isPending}>
            {createOrg.isPending ? "Creating…" : "Create organization"}
          </Button>
        </form>
      </section>

      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Your organizations</h2>
        {orgs.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : orgs.data && orgs.data.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {orgs.data.map((m, i) => {
              const org = m.organizations as { id: string; name: string; slug: string; description: string | null } | null;
              if (!org) return null;
              return (
                <li key={org.id ?? i} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{org.name}</p>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase">{m.role}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">/{org.slug}</p>
                  {org.description && <p className="mt-2 text-sm">{org.description}</p>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No organizations yet.</p>
        )}
      </section>
    </div>
  );
}
