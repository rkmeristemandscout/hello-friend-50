import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { profileSchema, type ProfileValues } from "@/lib/auth-schemas";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarSignedUrl, setAvatarSignedUrl] = useState<string | null>(null);

  const profile = useQuery({
    enabled: !!user,
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { register, handleSubmit, formState, reset } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: "" },
  });

  useEffect(() => {
    if (profile.data) reset({ fullName: profile.data.full_name ?? "" });
  }, [profile.data, reset]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!profile.data?.avatar_url) return setAvatarSignedUrl(null);
      const { data } = await supabase.storage.from("avatars").createSignedUrl(profile.data.avatar_url, 3600);
      if (!cancelled) setAvatarSignedUrl(data?.signedUrl ?? null);
    }
    load();
    return () => { cancelled = true; };
  }, [profile.data?.avatar_url]);

  const saveProfile = useMutation({
    mutationFn: async (v: ProfileValues) => {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: v.fullName })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Not signed in");
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", user.id);
      if (dbErr) throw dbErr;
    },
    onSuccess: () => {
      toast.success("Avatar updated");
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const initials = (profile.data?.full_name || user?.email || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage your account details.</p>
      </div>

      <section className="flex items-center gap-6 rounded-xl border bg-card p-6">
        <Avatar className="h-20 w-20">
          {avatarSignedUrl && <AvatarImage src={avatarSignedUrl} alt="Avatar" />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium">{profile.data?.full_name ?? user?.email}</p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadAvatar.isPending}>
              {uploadAvatar.isPending ? "Uploading…" : "Upload avatar"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAvatar.mutate(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </section>

      <form onSubmit={handleSubmit((v) => saveProfile.mutate(v))} className="space-y-4 rounded-xl border bg-card p-6">
        <div>
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" {...register("fullName")} />
          {formState.errors.fullName && (
            <p className="mt-1 text-xs text-destructive">{formState.errors.fullName.message}</p>
          )}
        </div>
        <div>
          <Label>Email</Label>
          <Input value={user?.email ?? ""} disabled />
        </div>
        <Button type="submit" disabled={saveProfile.isPending}>
          {saveProfile.isPending ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </div>
  );
}
