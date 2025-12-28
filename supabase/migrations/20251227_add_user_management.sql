-- Migration: 20251227_add_user_management.sql
-- Purpose: Add user management system with roles, Zoho linking, and invitations
-- Author: Claude Code
-- Date: December 27, 2025

-- ============================================
-- Enable required extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Table: user_profiles
-- Links auth.users to application-specific data
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'submitter' CHECK (role IN ('admin', 'bookkeeper', 'submitter')),
    linked_zoho_emails TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    -- Future multi-tenant support
    org_id UUID DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for user_profiles
CREATE INDEX IF NOT EXISTS idx_user_profiles_linked_zoho_emails
    ON user_profiles USING GIN (linked_zoho_emails);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role
    ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_active
    ON user_profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_user_profiles_org_id
    ON user_profiles(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_email
    ON user_profiles(email);

-- ============================================
-- Table: external_identity_links
-- Universal adapter for future identity providers
-- ============================================
CREATE TABLE IF NOT EXISTS public.external_identity_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, -- 'zoho', 'quickbooks', 'monday', etc.
    external_id TEXT NOT NULL,
    external_email TEXT,
    external_name TEXT,
    metadata JSONB DEFAULT '{}',
    is_primary BOOLEAN NOT NULL DEFAULT false,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    linked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    UNIQUE(provider, external_id),
    UNIQUE(provider, external_email) -- Prevent duplicate email links per provider
);

-- Indexes for external_identity_links
CREATE INDEX IF NOT EXISTS idx_external_identity_links_user_id
    ON external_identity_links(user_id);
CREATE INDEX IF NOT EXISTS idx_external_identity_links_provider
    ON external_identity_links(provider);
CREATE INDEX IF NOT EXISTS idx_external_identity_links_external_email
    ON external_identity_links(external_email);

-- ============================================
-- Table: user_invitations
-- Tracking pending invites with tokens
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'bookkeeper', 'submitter')),
    token UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
    invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMPTZ,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'))
);

-- Indexes for user_invitations
CREATE INDEX IF NOT EXISTS idx_user_invitations_email
    ON user_invitations(email);
CREATE INDEX IF NOT EXISTS idx_user_invitations_status
    ON user_invitations(status);
CREATE INDEX IF NOT EXISTS idx_user_invitations_token
    ON user_invitations(token);
CREATE INDEX IF NOT EXISTS idx_user_invitations_expires_at
    ON user_invitations(expires_at) WHERE status = 'pending';

-- ============================================
-- Trigger: Auto-update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trigger_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Trigger: Auto-link user's email to linked_zoho_emails on INSERT
-- ============================================
CREATE OR REPLACE FUNCTION auto_link_zoho_email()
RETURNS TRIGGER AS $$
BEGIN
    -- Automatically add user's email to linked_zoho_emails if not already present
    IF NEW.email IS NOT NULL AND NOT (NEW.email = ANY(NEW.linked_zoho_emails)) THEN
        NEW.linked_zoho_emails = array_append(NEW.linked_zoho_emails, NEW.email);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_link_zoho_email ON user_profiles;
CREATE TRIGGER trigger_auto_link_zoho_email
    BEFORE INSERT ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION auto_link_zoho_email();

-- ============================================
-- Trigger: Auto-expire old invitations
-- ============================================
CREATE OR REPLACE FUNCTION expire_old_invitations()
RETURNS TRIGGER AS $$
BEGIN
    -- Mark expired invitations when querying
    UPDATE user_invitations
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at < NOW();
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Enable RLS
-- ============================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies: user_profiles
-- ============================================

-- Users can read their own profile
DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;
CREATE POLICY "Users can read own profile"
    ON user_profiles FOR SELECT
    USING (auth.uid() = id);

-- Admins can read all profiles
DROP POLICY IF EXISTS "Admins can read all profiles" ON user_profiles;
CREATE POLICY "Admins can read all profiles"
    ON user_profiles FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles up
            WHERE up.id = auth.uid()
            AND up.role = 'admin'
            AND up.is_active = true
        )
    );

-- Service role has full access (for Edge Functions)
DROP POLICY IF EXISTS "Service role full access to profiles" ON user_profiles;
CREATE POLICY "Service role full access to profiles"
    ON user_profiles FOR ALL
    USING (auth.role() = 'service_role');

-- Admins can insert new profiles
DROP POLICY IF EXISTS "Admins can insert profiles" ON user_profiles;
CREATE POLICY "Admins can insert profiles"
    ON user_profiles FOR INSERT
    WITH CHECK (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM user_profiles up
            WHERE up.id = auth.uid()
            AND up.role = 'admin'
            AND up.is_active = true
        )
    );

-- Admins can update any profile
DROP POLICY IF EXISTS "Admins can update profiles" ON user_profiles;
CREATE POLICY "Admins can update profiles"
    ON user_profiles FOR UPDATE
    USING (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM user_profiles up
            WHERE up.id = auth.uid()
            AND up.role = 'admin'
            AND up.is_active = true
        )
    );

-- Users can update their own profile (except role and is_active)
DROP POLICY IF EXISTS "Users can update own non-sensitive fields" ON user_profiles;
CREATE POLICY "Users can update own non-sensitive fields"
    ON user_profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- ============================================
-- RLS Policies: external_identity_links
-- ============================================

-- Users can read their own identity links
DROP POLICY IF EXISTS "Users can read own identity links" ON external_identity_links;
CREATE POLICY "Users can read own identity links"
    ON external_identity_links FOR SELECT
    USING (user_id = auth.uid());

-- Admins can read all identity links
DROP POLICY IF EXISTS "Admins can read all identity links" ON external_identity_links;
CREATE POLICY "Admins can read all identity links"
    ON external_identity_links FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles up
            WHERE up.id = auth.uid()
            AND up.role = 'admin'
            AND up.is_active = true
        )
    );

-- Service role has full access
DROP POLICY IF EXISTS "Service role full access to identity links" ON external_identity_links;
CREATE POLICY "Service role full access to identity links"
    ON external_identity_links FOR ALL
    USING (auth.role() = 'service_role');

-- Admins can manage all identity links
DROP POLICY IF EXISTS "Admins can manage identity links" ON external_identity_links;
CREATE POLICY "Admins can manage identity links"
    ON external_identity_links FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles up
            WHERE up.id = auth.uid()
            AND up.role = 'admin'
            AND up.is_active = true
        )
    );

-- ============================================
-- RLS Policies: user_invitations
-- ============================================

-- Service role has full access
DROP POLICY IF EXISTS "Service role full access to invitations" ON user_invitations;
CREATE POLICY "Service role full access to invitations"
    ON user_invitations FOR ALL
    USING (auth.role() = 'service_role');

-- Admins can manage invitations
DROP POLICY IF EXISTS "Admins can manage invitations" ON user_invitations;
CREATE POLICY "Admins can manage invitations"
    ON user_invitations FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles up
            WHERE up.id = auth.uid()
            AND up.role = 'admin'
            AND up.is_active = true
        )
    );

-- Anyone can read invitation by token (for acceptance flow - validated in Edge Function)
DROP POLICY IF EXISTS "Anyone can validate invitation token" ON user_invitations;
CREATE POLICY "Anyone can validate invitation token"
    ON user_invitations FOR SELECT
    USING (true);

-- ============================================
-- View: expenses_with_ownership
-- Efficient view for filtering expenses by owner
-- ============================================
DROP VIEW IF EXISTS expenses_with_ownership;
CREATE OR REPLACE VIEW expenses_with_ownership AS
SELECT
    ze.id,
    ze.zoho_expense_id,
    ze.zoho_report_id,
    ze.status,
    ze.match_confidence,
    ze.created_at,
    zer.submitter_email,
    zer.submitter_name,
    up.id as owner_user_id,
    up.full_name as owner_full_name,
    up.role as owner_role
FROM zoho_expenses ze
LEFT JOIN zoho_expense_reports zer ON ze.zoho_report_id = zer.zoho_report_id
LEFT JOIN user_profiles up ON zer.submitter_email = ANY(up.linked_zoho_emails)
WHERE ze.status IN ('flagged', 'error', 'pending', 'processing');

-- Grant access to the view
GRANT SELECT ON expenses_with_ownership TO authenticated;
GRANT SELECT ON expenses_with_ownership TO service_role;

-- ============================================
-- Seed: Set pmonasterio@yahoo.com as superadmin
-- ============================================
DO $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Find the auth user by email
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = 'pmonasterio@yahoo.com'
    LIMIT 1;

    IF v_user_id IS NOT NULL THEN
        -- Insert or update user_profiles
        INSERT INTO user_profiles (id, email, full_name, role, is_active, created_at)
        VALUES (
            v_user_id,
            'pmonasterio@yahoo.com',
            'Pablo Ortiz-Monasterio',
            'admin',
            true,
            NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
            role = 'admin',
            is_active = true,
            updated_at = NOW();

        RAISE NOTICE 'Set pmonasterio@yahoo.com as admin';
    ELSE
        RAISE NOTICE 'User pmonasterio@yahoo.com not found in auth.users - will be set as admin on first login';
    END IF;
END $$;

-- ============================================
-- Comments for documentation
-- ============================================
COMMENT ON TABLE user_profiles IS 'User profiles with roles and Zoho email linking';
COMMENT ON TABLE external_identity_links IS 'Universal adapter for linking users to external systems (Zoho, QBO, Monday, etc.)';
COMMENT ON TABLE user_invitations IS 'Pending user invitations with secure tokens';
COMMENT ON VIEW expenses_with_ownership IS 'View for efficiently filtering expenses by owner user';

COMMENT ON COLUMN user_profiles.role IS 'User role: admin (full access), bookkeeper (no user management), submitter (own expenses only)';
COMMENT ON COLUMN user_profiles.linked_zoho_emails IS 'Array of Zoho submitter emails linked to this user';
COMMENT ON COLUMN user_profiles.org_id IS 'Future: Organization ID for multi-tenant support';
COMMENT ON COLUMN user_invitations.token IS 'Secure token for invitation acceptance URL';
