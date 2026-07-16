
-- Fix broken self-insert on organization_members: restrict INSERT to owners/admins only.
-- Legitimate self-joins happen through accept_invitation() and create_organization() (SECURITY DEFINER).
DROP POLICY IF EXISTS "Owners/admins can add members" ON public.organization_members;
CREATE POLICY "Owners/admins can add members"
  ON public.organization_members
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]));

-- Restrict profiles visibility: only self or users sharing an organization.
CREATE OR REPLACE FUNCTION public.shares_org_with(_other uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _other = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members a
      JOIN public.organization_members b
        ON a.organization_id = b.organization_id
      WHERE a.user_id = auth.uid()
        AND b.user_id = _other
    );
$$;

REVOKE ALL ON FUNCTION public.shares_org_with(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shares_org_with(uuid) TO authenticated;

DROP POLICY IF EXISTS "Profiles viewable by authenticated users" ON public.profiles;
CREATE POLICY "Profiles viewable by org members or self"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_super_admin(auth.uid()) OR public.shares_org_with(id));
