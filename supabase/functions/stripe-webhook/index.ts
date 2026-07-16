// Supabase Edge Function: stripe-webhook
// Verifies Stripe signatures and syncs subscriptions/payments/invoices/usage_metrics.
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-11-20.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

async function planIdFromPrice(priceId?: string | null) {
  if (!priceId) return null;
  const { data } = await supabase.from("plans").select("id").eq("stripe_price_id", priceId).maybeSingle();
  return data?.id ?? null;
}

async function orgIdFromCustomer(customerId?: string | null) {
  if (!customerId) return null;
  const { data } = await supabase
    .from("subscriptions")
    .select("organization_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.organization_id ?? null;
}

function ts(sec?: number | null) {
  return sec ? new Date(sec * 1000).toISOString() : null;
}

async function upsertSubscription(sub: any, orgIdHint?: string | null, forceDeleted = false) {
  const orgId = orgIdHint ?? sub.metadata?.organization_id ?? (await orgIdFromCustomer(sub.customer));
  if (!orgId) return;
  const planId = forceDeleted
    ? (await supabase.from("plans").select("id").eq("key", "free").maybeSingle()).data?.id ?? null
    : await planIdFromPrice(sub.items?.data?.[0]?.price?.id);
  await supabase.from("subscriptions").upsert(
    {
      organization_id: orgId,
      plan_id: planId,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: forceDeleted ? null : sub.id,
      status: forceDeleted ? "canceled" : sub.status,
      current_period_start: ts(sub.current_period_start),
      current_period_end: ts(sub.current_period_end),
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      canceled_at: ts(sub.canceled_at),
      trial_end: ts(sub.trial_end),
    },
    { onConflict: "organization_id" },
  );

  // usage_metrics: record a "subscription_status" datapoint
  await supabase.from("usage_metrics").insert({
    organization_id: orgId,
    metric: "subscription_status",
    value: forceDeleted ? 0 : 1,
    metadata: { status: forceDeleted ? "canceled" : sub.status, plan_id: planId },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing stripe-signature", { status: 400 });
  if (!webhookSecret) return new Response("Webhook secret not configured", { status: 500 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider);
  } catch (err) {
    return new Response(`Signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as any;
        if (s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription as string);
          await upsertSubscription(sub, s.metadata?.organization_id ?? null);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await upsertSubscription(event.data.object);
        break;
      case "customer.subscription.deleted":
        await upsertSubscription(event.data.object, null, true);
        break;

      case "invoice.paid":
      case "invoice.payment_failed": {
        const inv = event.data.object as any;
        const orgId = await orgIdFromCustomer(inv.customer);
        if (orgId) {
          await supabase.from("invoices").upsert(
            {
              organization_id: orgId,
              stripe_invoice_id: inv.id,
              number: inv.number,
              amount_due_cents: inv.amount_due,
              amount_paid_cents: inv.amount_paid,
              currency: inv.currency,
              status: inv.status ?? "open",
              hosted_invoice_url: inv.hosted_invoice_url,
              invoice_pdf: inv.invoice_pdf,
              period_start: ts(inv.period_start),
              period_end: ts(inv.period_end),
            },
            { onConflict: "stripe_invoice_id" },
          );
          await supabase.from("usage_metrics").insert({
            organization_id: orgId,
            metric: event.type === "invoice.paid" ? "invoice_paid" : "invoice_failed",
            value: (inv.amount_paid ?? inv.amount_due ?? 0) / 100,
            metadata: { currency: inv.currency, invoice_id: inv.id },
          });
        }
        break;
      }

      case "payment_intent.succeeded":
      case "payment_intent.payment_failed": {
        const pi = event.data.object as any;
        const orgId = await orgIdFromCustomer(pi.customer);
        if (orgId) {
          const charge = pi.latest_charge
            ? await stripe.charges.retrieve(pi.latest_charge as string).catch(() => null)
            : null;
          await supabase.from("payments").upsert(
            {
              organization_id: orgId,
              stripe_payment_intent_id: pi.id,
              stripe_charge_id: charge?.id ?? null,
              stripe_invoice_id: (pi.invoice as string) ?? null,
              amount_cents: pi.amount,
              currency: pi.currency,
              status: pi.status,
              description: pi.description,
              receipt_url: charge?.receipt_url ?? null,
              paid_at: pi.status === "succeeded" ? new Date().toISOString() : null,
            },
            { onConflict: "stripe_payment_intent_id" },
          );
          await supabase.from("usage_metrics").insert({
            organization_id: orgId,
            metric: pi.status === "succeeded" ? "payment_succeeded" : "payment_failed",
            value: (pi.amount ?? 0) / 100,
            metadata: { currency: pi.currency, payment_intent: pi.id },
          });
        }
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("stripe-webhook handler error", err);
    return new Response((err as Error).message ?? "Handler error", { status: 500 });
  }
});
