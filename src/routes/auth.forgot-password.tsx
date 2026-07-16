import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { forgotSchema, type ForgotValues } from "@/lib/auth-schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth/forgot-password")({
  component: ForgotPage,
});

function ForgotPage() {
  const { register, handleSubmit, formState } = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
  });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(values: ForgotValues) {
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    setSent(true);
    toast.success("Password reset email sent");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Reset your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your email and we'll send you a link to reset it.
        </p>
        {sent ? (
          <div className="mt-6 rounded-lg border bg-muted/40 p-4 text-sm">
            If an account exists for that email, a reset link is on its way.
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...register("email")} />
              {formState.errors.email && (
                <p className="mt-1 text-xs text-destructive">{formState.errors.email.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
        <div className="mt-6 text-center text-sm">
          <Link to="/auth" search={{ mode: "signin" }} className="text-muted-foreground hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
