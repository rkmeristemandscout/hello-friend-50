
DROP POLICY IF EXISTS "audit_logs self insert" ON public.audit_logs;
CREATE POLICY "audit_logs self insert"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND (
      public.is_super_admin(auth.uid())
      OR (organization_id IS NOT NULL AND public.is_org_member(organization_id, auth.uid()))
    )
  );
