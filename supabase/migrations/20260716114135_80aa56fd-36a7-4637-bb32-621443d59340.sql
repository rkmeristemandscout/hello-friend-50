
-- PLANS
CREATE TABLE public.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  interval TEXT NOT NULL DEFAULT 'month' CHECK (interval IN ('month','year','one_time')),
  stripe_price_id TEXT UNIQUE,
  stripe_product_id TEXT,
  member_limit INTEGER,
  team_limit INTEGER,
  department_limit INTEGER,
  api_key_limit INTEGER,
  storage_limit_mb INTEGER,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans_read_all" ON public.plans FOR SELECT USING (true);
CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- SUBSCRIPTIONS
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.plans(id),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'inactive',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subs_read_admins" ON public.subscriptions FOR SELECT TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]));
CREATE TRIGGER trg_subs_updated BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_subs_org ON public.subscriptions(organization_id);
CREATE INDEX idx_subs_customer ON public.subscriptions(stripe_customer_id);

-- PAYMENTS
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_charge_id TEXT,
  stripe_invoice_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL,
  description TEXT,
  receipt_url TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_read_admins" ON public.payments FOR SELECT TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]));
CREATE INDEX idx_payments_org ON public.payments(organization_id, created_at DESC);

-- INVOICES
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT UNIQUE NOT NULL,
  number TEXT,
  amount_due_cents INTEGER NOT NULL DEFAULT 0,
  amount_paid_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL,
  hosted_invoice_url TEXT,
  invoice_pdf TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_read_admins" ON public.invoices FOR SELECT TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]));
CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_invoices_org ON public.invoices(organization_id, created_at DESC);

-- USAGE METRICS
CREATE TABLE public.usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  period_end TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', now()) + INTERVAL '1 month'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, metric, period_start)
);
GRANT SELECT ON public.usage_metrics TO authenticated;
GRANT ALL ON public.usage_metrics TO service_role;
ALTER TABLE public.usage_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_read_members" ON public.usage_metrics FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));
CREATE INDEX idx_usage_org_metric ON public.usage_metrics(organization_id, metric, period_start DESC);

-- Seed default plans (Stripe price IDs added later once Stripe products are created)
INSERT INTO public.plans (key, name, description, price_cents, interval, member_limit, team_limit, department_limit, api_key_limit, storage_limit_mb, features, sort_order) VALUES
  ('free',       'Free',       'For getting started',        0,    'month', 3,   1,   2,   2,   100,    '["Community support","Basic analytics"]'::jsonb, 1),
  ('starter',    'Starter',    'For small teams',            1900, 'month', 10,  5,   5,   10,  5000,   '["Email support","Advanced analytics","API access"]'::jsonb, 2),
  ('pro',        'Pro',        'For growing organizations',  4900, 'month', 50,  25,  25,  50,  50000,  '["Priority support","Audit logs","SSO","Advanced roles"]'::jsonb, 3),
  ('enterprise', 'Enterprise', 'For large organizations',    19900,'month', NULL,NULL,NULL,NULL,NULL,   '["Dedicated support","Custom contract","Unlimited everything","SLA"]'::jsonb, 4);

-- Give every existing organization a free subscription row
INSERT INTO public.subscriptions (organization_id, plan_id, status)
SELECT o.id, (SELECT id FROM public.plans WHERE key = 'free'), 'active'
FROM public.organizations o
ON CONFLICT (organization_id) DO NOTHING;

-- Trigger: create free subscription when new organization is created
CREATE OR REPLACE FUNCTION public.create_free_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.subscriptions (organization_id, plan_id, status)
  VALUES (NEW.id, (SELECT id FROM public.plans WHERE key = 'free'), 'active')
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_org_free_sub AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.create_free_subscription();
