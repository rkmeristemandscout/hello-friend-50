import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { Building2, Lock, Users } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { user, loading } = useSession();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Stackly
          </Link>
          <nav className="flex items-center gap-2">
            {loading ? null : user ? (
              <Button asChild size="sm">
                <Link to="/dashboard">Open app</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/auth" search={{ mode: "signin" }}>
                    Sign in
                  </Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/auth" search={{ mode: "signup" }}>
                    Get started
                  </Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          A production-ready foundation for your SaaS.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Multi-tenant workspaces, authentication, roles, and everything you need to ship your
          next Slack or Notion competitor.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/auth" search={{ mode: "signup" }}>
              Create your workspace
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/auth" search={{ mode: "signin" }}>
              Sign in
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-24 md:grid-cols-3">
        {[
          { icon: Lock, title: "Secure auth", body: "Email, Google, password reset, and email verification." },
          { icon: Building2, title: "Organizations", body: "Multi-tenant workspaces with owner, admin, and member roles." },
          { icon: Users, title: "Team members", body: "Invite, manage, and scope access per workspace." },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border bg-card p-6">
            <Icon className="h-6 w-6 text-primary" />
            <h3 className="mt-4 text-lg font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
