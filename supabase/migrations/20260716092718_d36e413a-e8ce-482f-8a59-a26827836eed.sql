
-- =========================================================
-- RBAC: roles, permissions, role_permissions, user_roles
-- =========================================================

-- 1) permissions catalog
CREATE TABLE public.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.permissions TO authenticated;
GRANT ALL ON public.permissions TO service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "permissions readable by authenticated"
  ON public.permissions FOR SELECT TO authenticated USING (true);

-- 2) roles catalog (global definitions)
CREATE TABLE public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global','organization')),
  rank INT NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.roles TO authenticated;
GRANT ALL ON public.roles TO service_role;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles readable by authenticated"
  ON public.roles FOR SELECT TO authenticated USING (true);

-- 3) role_permissions matrix
CREATE TABLE public.role_permissions (
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX role_permissions_permission_idx ON public.role_permissions(permission_id);
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_permissions readable by authenticated"
  ON public.role_permissions FOR SELECT TO authenticated USING (true);

-- 4) user_roles assignments (per-org, org null = global i.e. super admin)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id, organization_id)
);
CREATE INDEX user_roles_user_idx ON public.user_roles(user_id);
CREATE INDEX user_roles_org_idx ON public.user_roles(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- Helper functions (SECURITY DEFINER, no recursion)
-- =========================================================

CREATE OR REPLACE FUNCTION public.is_super_admin(_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = _user AND r.key = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_user UUID, _org UUID, _perm TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.is_super_admin(_user)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = _user
        AND p.key = _perm
        AND (ur.organization_id = _org OR ur.organization_id IS NULL)
    );
$$;

CREATE OR REPLACE FUNCTION public.get_user_permissions(_org UUID)
RETURNS TABLE(permission_key TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT p.key
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = auth.uid()
    AND (ur.organization_id = _org OR ur.organization_id IS NULL);
$$;

CREATE OR REPLACE FUNCTION public.get_user_roles(_org UUID)
RETURNS TABLE(role_key TEXT, role_name TEXT, organization_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.key, r.name, ur.organization_id
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = auth.uid()
    AND (ur.organization_id = _org OR ur.organization_id IS NULL);
$$;

-- =========================================================
-- RLS for user_roles
-- =========================================================
CREATE POLICY "users read own role assignments"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "org admins read org role assignments"
  ON public.user_roles FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.has_permission(auth.uid(), organization_id, 'org.manage_users')
  );

CREATE POLICY "super admin reads all role assignments"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "org admins grant org roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND public.has_permission(auth.uid(), organization_id, 'org.manage_users')
    AND NOT EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_id AND r.key = 'super_admin'
    )
  );

CREATE POLICY "org admins revoke org roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.has_permission(auth.uid(), organization_id, 'org.manage_users')
  );

CREATE POLICY "super admin manages all role assignments"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- =========================================================
-- Seed permissions
-- =========================================================
INSERT INTO public.permissions (key, category, description) VALUES
  ('org.view',              'Organization', 'View organization'),
  ('org.update',            'Organization', 'Update organization settings'),
  ('org.delete',            'Organization', 'Delete organization'),
  ('org.manage_billing',    'Organization', 'Manage billing'),
  ('org.manage_api_keys',   'Organization', 'Manage API keys'),
  ('org.manage_users',      'Organization', 'Manage users and roles'),
  ('org.invite_members',    'Organization', 'Invite members'),
  ('org.remove_members',    'Organization', 'Remove members'),
  ('team.view',             'Teams',        'View teams'),
  ('team.create',           'Teams',        'Create teams'),
  ('team.update',           'Teams',        'Update teams'),
  ('team.delete',           'Teams',        'Delete teams'),
  ('team.manage_members',   'Teams',        'Manage team members'),
  ('department.view',       'Departments',  'View departments'),
  ('department.create',     'Departments',  'Create departments'),
  ('department.update',     'Departments',  'Update departments'),
  ('department.delete',     'Departments',  'Delete departments'),
  ('invitation.view',       'Invitations',  'View invitations'),
  ('invitation.manage',     'Invitations',  'Resend, expire, revoke invitations'),
  ('platform.admin',        'Platform',     'Full platform administration');

-- =========================================================
-- Seed roles
-- =========================================================
INSERT INTO public.roles (key, name, description, scope, rank) VALUES
  ('super_admin',        'Super Admin',        'Full platform access across all organizations', 'global',       100),
  ('organization_owner', 'Organization Owner', 'Full control over the organization',            'organization',  90),
  ('admin',              'Admin',              'Administer organization settings and members',  'organization',  80),
  ('manager',            'Manager',            'Manage teams and members',                      'organization',  60),
  ('employee',           'Employee',           'Standard member access',                        'organization',  40),
  ('guest',              'Guest',              'Read-only limited access',                      'organization',  20);

-- =========================================================
-- Seed role_permissions
-- =========================================================
-- super_admin: everything
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.key = 'super_admin';

-- organization_owner: everything except platform.admin
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.key = 'organization_owner' AND p.key <> 'platform.admin';

-- admin: everything except delete org, billing, api keys, platform
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.key = 'admin' AND p.key NOT IN ('org.delete','org.manage_billing','org.manage_api_keys','platform.admin');

-- manager: team + department manage, invite members, view org
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.key = 'manager' AND p.key IN (
  'org.view','team.view','team.create','team.update','team.delete','team.manage_members',
  'department.view','department.create','department.update',
  'invitation.view','org.invite_members'
);

-- employee: view + limited
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.key = 'employee' AND p.key IN (
  'org.view','team.view','department.view','invitation.view'
);

-- guest: view only org + teams
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.key = 'guest' AND p.key IN ('org.view','team.view','department.view');

-- =========================================================
-- Sync organization_members.role -> user_roles
-- Backfill existing rows and keep in sync via trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.sync_member_role_to_user_roles()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _role_key TEXT;
  _role_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.user_roles ur
      USING public.roles r
      WHERE ur.role_id = r.id
        AND ur.user_id = OLD.user_id
        AND ur.organization_id = OLD.organization_id
        AND r.key IN ('organization_owner','admin','employee');
    RETURN OLD;
  END IF;

  _role_key := CASE NEW.role::text
    WHEN 'owner'  THEN 'organization_owner'
    WHEN 'admin'  THEN 'admin'
    WHEN 'member' THEN 'employee'
  END;
  SELECT id INTO _role_id FROM public.roles WHERE key = _role_key;

  IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role THEN
    DELETE FROM public.user_roles ur
      USING public.roles r
      WHERE ur.role_id = r.id
        AND ur.user_id = NEW.user_id
        AND ur.organization_id = NEW.organization_id
        AND r.key IN ('organization_owner','admin','employee');
  END IF;

  INSERT INTO public.user_roles (user_id, role_id, organization_id, granted_by)
  VALUES (NEW.user_id, _role_id, NEW.organization_id, auth.uid())
  ON CONFLICT (user_id, role_id, organization_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_member_role
AFTER INSERT OR UPDATE OR DELETE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.sync_member_role_to_user_roles();

-- Backfill existing members
INSERT INTO public.user_roles (user_id, role_id, organization_id)
SELECT om.user_id, r.id, om.organization_id
FROM public.organization_members om
JOIN public.roles r
  ON r.key = CASE om.role::text
    WHEN 'owner'  THEN 'organization_owner'
    WHEN 'admin'  THEN 'admin'
    WHEN 'member' THEN 'employee'
  END
ON CONFLICT (user_id, role_id, organization_id) DO NOTHING;
