import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, UserPlus } from "lucide-react";

type OrgMemberRow = {
  user_id: string;
  role: string;
  profile: { full_name: string | null } | null;
};

export const Route = createFileRoute("/_authenticated/teams/$teamId")({
  component: TeamDetail,
});

function TeamDetail() {
  const { teamId } = useParams({ from: "/_authenticated/teams/$teamId" });
  const { user } = useSession();
  const { currentMembership } = useCurrentOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const team = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, slug, description, owner_id, organization_id")
        .eq("id", teamId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const inSameOrg = team.data?.organization_id === currentMembership?.organization.id;
  const canManage =
    !!team.data &&
    (team.data.owner_id === user?.id ||
      (inSameOrg &&
        (currentMembership?.role === "owner" || currentMembership?.role === "admin")));

  const members = useQuery({
    enabled: !!team.data,
    queryKey: ["team-members", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_members")
        .select("id, user_id, role, created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const ids = Array.from(new Set((data ?? []).map((m) => m.user_id)));
      let profiles: Record<string, { full_name: string | null }> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles").select("id, full_name").in("id", ids);
        profiles = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
      }
      return (data ?? []).map((m) => ({ ...m, profile: profiles[m.user_id] ?? null }));
    },
  });

  const orgMembers = useQuery({
    enabled: !!team.data,
    queryKey: ["org-members-for-team", team.data?.organization_id],
    queryFn: async (): Promise<OrgMemberRow[]> => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", team.data!.organization_id);
      if (error) throw error;
      const ids = (data ?? []).map((m) => m.user_id);
      let profiles: Record<string, { full_name: string | null }> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles").select("id, full_name").in("id", ids);
        profiles = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
      }
      return (data ?? []).map((m) => ({ ...m, profile: profiles[m.user_id] ?? null }));
    },
  });

  const { register, handleSubmit, reset, formState } = useForm<TeamValues>({
    resolver: zodResolver(teamSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  useEffect(() => {
    if (team.data) {
      reset({
        name: team.data.name,
        slug: team.data.slug,
        description: team.data.description ?? "",
      });
    }
  }, [team.data, reset]);

  const save = useMutation({
    mutationFn: async (v: TeamValues) => {
      const { error } = await supabase
        .from("teams")
        .update({ name: v.name, slug: v.slug, description: v.description || null })
        .eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Team updated");
      qc.invalidateQueries({ queryKey: ["team", teamId] });
      qc.invalidateQueries({ queryKey: ["teams"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [ownerCandidate, setOwnerCandidate] = useState<string>("");
  const transferOwner = useMutation({
    mutationFn: async (newOwner: string) => {
      const { error } = await supabase.from("teams").update({ owner_id: newOwner }).eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ownership transferred");
      qc.invalidateQueries({ queryKey: ["team", teamId] });
      qc.invalidateQueries({ queryKey: ["team-members", teamId] });
      setOwnerCandidate("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("teams").delete().eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Team deleted");
      qc.invalidateQueries({ queryKey: ["teams"] });
      navigate({ to: "/teams" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [addUser, setAddUser] = useState<string>("");
  const addMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("team_members").insert({
        team_id: teamId, user_id: userId, role: "member",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member added");
      qc.invalidateQueries({ queryKey: ["team-members", teamId] });
      setAddUser("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("team_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member removed");
      qc.invalidateQueries({ queryKey: ["team-members", teamId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (team.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!team.data) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Team not found</h2>
        <Link to="/teams" className="mt-4 inline-block text-sm underline">Back to teams</Link>
      </div>
    );
  }

  const memberIds = new Set(members.data?.map((m) => m.user_id) ?? []);
  const availableToAdd = (orgMembers.data ?? []).filter((m) => !memberIds.has(m.user_id));

  return (
    <div className="space-y-6">
      <div>
        <Link to="/teams" className="text-sm text-muted-foreground hover:underline">← All teams</Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{team.data.name}</h1>
        <p className="text-sm text-muted-foreground">/{team.data.slug}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-xl border bg-card p-6 lg:col-span-3">
          <h2 className="text-lg font-semibold">Members</h2>
          {members.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ul className="mt-4 divide-y">
              {members.data?.map((m) => {
                const isSelf = m.user_id === user?.id;
                return (
                  <li key={m.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">
                        {m.profile?.full_name ?? m.user_id.slice(0, 8)}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Joined {new Date(m.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={m.role === "owner" ? "default" : "secondary"}>{m.role}</Badge>
                      {canManage && m.role !== "owner" && (
                        <Button size="icon" variant="ghost" aria-label="Remove"
                          onClick={() => removeMember.mutate(m.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {canManage && (
            <div className="mt-6 flex items-end gap-2 border-t pt-4">
              <div className="flex-1">
                <Label>Add organization member</Label>
                <Select value={addUser} onValueChange={setAddUser}>
                  <SelectTrigger><SelectValue placeholder="Select member…" /></SelectTrigger>
                  <SelectContent>
                    {availableToAdd.length === 0 && (
                      <SelectItem value="__none" disabled>No available members</SelectItem>
                    )}
                    {availableToAdd.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.profile?.full_name ?? m.user_id.slice(0, 8)} · {m.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => addUser && addMember.mutate(addUser)}
                disabled={!addUser || addMember.isPending}
              >
                <UserPlus className="mr-1 h-4 w-4" /> Add
              </Button>
            </div>
          )}
        </section>

        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold">Settings</h2>
            {canManage ? (
              <form onSubmit={handleSubmit((v) => save.mutate(v))} className="mt-4 space-y-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" {...register("name")} />
                  {formState.errors.name && <p className="mt-1 text-xs text-destructive">{formState.errors.name.message}</p>}
                </div>
                <div>
                  <Label htmlFor="slug">Slug</Label>
                  <Input id="slug" {...register("slug")} />
                  {formState.errors.slug && <p className="mt-1 text-xs text-destructive">{formState.errors.slug.message}</p>}
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" rows={3} {...register("description")} />
                </div>
                <Button type="submit" disabled={save.isPending} className="w-full">
                  {save.isPending ? "Saving…" : "Save changes"}
                </Button>
              </form>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Only the team owner or organization admins can edit settings.
              </p>
            )}
          </section>

          {canManage && (
            <section className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold">Transfer ownership</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Move ownership to another team member.
              </p>
              <div className="mt-4 flex items-end gap-2">
                <div className="flex-1">
                  <Select value={ownerCandidate} onValueChange={setOwnerCandidate}>
                    <SelectTrigger><SelectValue placeholder="Select member…" /></SelectTrigger>
                    <SelectContent>
                      {(members.data ?? [])
                        .filter((m) => m.user_id !== team.data!.owner_id)
                        .map((m) => (
                          <SelectItem key={m.user_id} value={m.user_id}>
                            {m.profile?.full_name ?? m.user_id.slice(0, 8)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  disabled={!ownerCandidate || transferOwner.isPending}
                  onClick={() => transferOwner.mutate(ownerCandidate)}
                >
                  Transfer
                </Button>
              </div>
            </section>
          )}

          {canManage && (
            <section className="rounded-xl border border-destructive/40 bg-card p-6">
              <h2 className="text-lg font-semibold text-destructive">Delete team</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Removes the team and all memberships. This can't be undone.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="mt-4">Delete team</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {team.data.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      All team memberships will be lost.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => del.mutate()}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
