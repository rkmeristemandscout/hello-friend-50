import { createFileRoute, useSearch, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { CreditCard, ExternalLink, Loader2, CheckCircle2, XCircle, RefreshCw, ArrowUpRight, Settings } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createCheckoutSession, createPortalSession, cancelSubscription,
  renewSubscription, changePlan,
} from "@/lib/billing.functions";

type BillingSearch = { checkout?: "success" | "cancel" };

export const Route = createFileRoute("/_authenticated/billing")({
  validateSearch: (s: Record<string, unknown>): BillingSearch => ({
    checkout: s.checkout === "success" || s.checkout === "cancel" ? s.checkout : undefined,
  }),
  component: BillingPage,
});

function BillingPage() {
  const { currentOrgId, currentMembership } = useCurrentOrg();
  const { isSuperAdmin } = usePermissions();
  const qc = useQueryClient();
  const search = useSearch({ from: "/_authenticated/billing" });
  const isAdmin = currentMembership?.role === "owner" || currentMembership?.role === "admin";

  const checkout = useServerFn(createCheckoutSession);
  const portal = useServerFn(createPortalSession);
  const cancelFn = useServerFn(cancelSubscription);
  const renewFn = useServerFn(renewSubscription);
  const changeFn = useServerFn(changePlan);

  useEffect(() => {
    if (search.checkout === "success") toast.success("Payment successful. Your plan is being updated.");
    if (search.checkout === "cancel") toast.info("Checkout canceled.");
  }, [search.checkout]);

  const plansQ = useQuery({
    queryKey: ["billing", "plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("*").eq("is_active", true).order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const subQ = useQuery({
    enabled: !!currentOrgId,
    queryKey: ["billing", "sub", currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*, plan:plan_id(*)")
        .eq("organization_id", currentOrgId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const invoicesQ = useQuery({
    enabled: !!currentOrgId && isAdmin,
    queryKey: ["billing", "invoices", currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices").select("*").eq("organization_id", currentOrgId!)
        .order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
  });

  const paymentsQ = useQuery({
    enabled: !!currentOrgId && isAdmin,
    queryKey: ["billing", "payments", currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments").select("*").eq("organization_id", currentOrgId!)
        .order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
  });

  const usageQ = useQuery({
    enabled: !!currentOrgId,
    queryKey: ["billing", "usage", currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("usage_metrics").select("*").eq("organization_id", currentOrgId!)
        .gte("period_start", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
        .order("recorded_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const successUrl = () => `${window.location.origin}/billing?checkout=success`;
  const cancelUrl = () => `${window.location.origin}/billing?checkout=cancel`;
  const returnUrl = () => `${window.location.origin}/billing`;

  const startCheckout = useMutation({
    mutationFn: async (planId: string) => checkout({
      data: { organizationId: currentOrgId!, planId, successUrl: successUrl(), cancelUrl: cancelUrl() },
    }),
    onSuccess: (r) => { if (r.url) window.location.href = r.url; },
    onError: (e: Error) => toast.error(e.message),
  });

  const openPortal = useMutation({
    mutationFn: async () => portal({ data: { organizationId: currentOrgId!, returnUrl: returnUrl() } }),
    onSuccess: (r) => { if (r.url) window.location.href = r.url; },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: async () => cancelFn({ data: { organizationId: currentOrgId!, immediately: false } }),
    onSuccess: () => {
      toast.success("Subscription will cancel at period end");
      qc.invalidateQueries({ queryKey: ["billing", "sub"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renewMut = useMutation({
    mutationFn: async () => renewFn({ data: { organizationId: currentOrgId! } }),
    onSuccess: () => {
      toast.success("Subscription renewed");
      qc.invalidateQueries({ queryKey: ["billing", "sub"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changeMut = useMutation({
    mutationFn: async (planId: string) => changeFn({ data: { organizationId: currentOrgId!, planId } }),
    onSuccess: () => {
      toast.success("Plan updated");
      qc.invalidateQueries({ queryKey: ["billing"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentOrgId) {
    return <EmptyState title="No organization selected" description="Pick an organization to manage billing." />;
  }

  const sub = subQ.data;
  const currentPlanKey = (sub?.plan as { key?: string } | null)?.key;
  const hasStripeSub = !!sub?.stripe_subscription_id;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">Manage your plan, payment method, and invoices.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSuperAdmin && (
            <Button variant="outline" asChild>
              <Link to="/billing/plans"><Settings className="mr-2 h-4 w-4" /> Plan Stripe mapping</Link>
            </Button>
          )}
          {isAdmin && hasStripeSub && (
            <Button variant="outline" onClick={() => openPortal.mutate()} disabled={openPortal.isPending}>
              {openPortal.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
              Manage in Stripe
            </Button>
          )}
        </div>
      </header>

      {!isAdmin && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          Only organization owners and admins can change plans or view invoices.
        </CardContent></Card>
      )}

      {/* Current subscription */}
      <Card>
        <CardHeader>
          <CardTitle>Current subscription</CardTitle>
          <CardDescription>Your organization's active plan and renewal status.</CardDescription>
        </CardHeader>
        <CardContent>
          {subQ.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : sub ? (
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">{(sub.plan as { name?: string } | null)?.name ?? "Free"}</span>
                  <Badge variant={sub.status === "active" || sub.status === "trialing" ? "default" : "secondary"}>
                    {sub.status}
                  </Badge>
                  {sub.cancel_at_period_end && <Badge variant="destructive">Canceling</Badge>}
                </div>
                {sub.current_period_end && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {sub.cancel_at_period_end ? "Ends" : "Renews"} on {format(new Date(sub.current_period_end), "PP")}
                  </p>
                )}
              </div>
              {isAdmin && hasStripeSub && (
                <div className="ml-auto flex gap-2">
                  {sub.cancel_at_period_end ? (
                    <Button onClick={() => renewMut.mutate()} disabled={renewMut.isPending} size="sm">
                      <RefreshCw className="mr-2 h-4 w-4" /> Renew
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending} size="sm">
                      <XCircle className="mr-2 h-4 w-4" /> Cancel
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No subscription record.</p>
          )}
        </CardContent>
      </Card>

      {/* Plans */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Plans</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {plansQ.isLoading && Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="h-52 animate-pulse" /></Card>
          ))}
          {plansQ.data?.map((plan) => {
            const isCurrent = currentPlanKey === plan.key;
            const isFree = plan.key === "free";
            const features = Array.isArray(plan.features) ? (plan.features as string[]) : [];
            return (
              <Card key={plan.id} className={isCurrent ? "border-primary" : ""}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{plan.name}</CardTitle>
                    {isCurrent && <Badge>Current</Badge>}
                  </div>
                  <div className="mt-2">
                    <span className="text-3xl font-semibold">
                      ${(plan.price_cents / 100).toFixed(0)}
                    </span>
                    {!isFree && <span className="text-sm text-muted-foreground">/{plan.interval}</span>}
                  </div>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="space-y-1 text-sm">
                    {features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{f}</span>
                      </li>
                    ))}
                    {plan.member_limit && <li className="text-muted-foreground">Up to {plan.member_limit} members</li>}
                  </ul>
                  {isAdmin && !isCurrent && !isFree && (
                    hasStripeSub ? (
                      <Button className="w-full" size="sm" onClick={() => changeMut.mutate(plan.id)} disabled={changeMut.isPending}>
                        <ArrowUpRight className="mr-2 h-4 w-4" /> Switch to {plan.name}
                      </Button>
                    ) : (
                      <Button className="w-full" size="sm" onClick={() => startCheckout.mutate(plan.id)} disabled={startCheckout.isPending}>
                        {startCheckout.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Subscribe
                      </Button>
                    )
                  )}
                  {isAdmin && !isCurrent && isFree && hasStripeSub && (
                    <Button variant="outline" className="w-full" size="sm" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}>
                      Downgrade to Free
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Usage */}
      <Card>
        <CardHeader>
          <CardTitle>Usage this month</CardTitle>
          <CardDescription>Metered activity for the current billing period.</CardDescription>
        </CardHeader>
        <CardContent>
          {usageQ.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (usageQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage recorded yet this period.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {usageQ.data!.map((u) => (
                <div key={u.id} className="rounded-lg border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{u.metric}</p>
                  <p className="mt-1 text-2xl font-semibold">{Number(u.value).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>Recent invoices from Stripe.</CardDescription>
          </CardHeader>
          <CardContent>
            {invoicesQ.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (invoicesQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoicesQ.data!.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs">{inv.number ?? inv.stripe_invoice_id}</TableCell>
                        <TableCell>{format(new Date(inv.created_at), "PP")}</TableCell>
                        <TableCell>${(inv.amount_paid_cents / 100).toFixed(2)} {inv.currency.toUpperCase()}</TableCell>
                        <TableCell><Badge variant={inv.status === "paid" ? "default" : "secondary"}>{inv.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          {inv.hosted_invoice_url && (
                            <Button size="sm" variant="ghost" asChild>
                              <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer">
                                View <ExternalLink className="ml-1 h-3 w-3" />
                              </a>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Payments */}
      {isAdmin && (paymentsQ.data ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
            <CardDescription>Recent payment attempts.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentsQ.data!.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{format(new Date(p.created_at), "PP")}</TableCell>
                      <TableCell>${(p.amount_cents / 100).toFixed(2)} {p.currency.toUpperCase()}</TableCell>
                      <TableCell><Badge variant={p.status === "succeeded" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.description ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
