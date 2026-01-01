// Supabase Edge Function: invite-user
// Creates user invitation and sends AS3-branded email via SendGrid
// Only admins can invite new users

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getInvitationEmailHtml } from './email-template.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface InviteRequest {
  email: string
  full_name: string
  role: 'admin' | 'bookkeeper' | 'submitter'
  invited_by: string
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: 'Full access to all features including user management',
  bookkeeper: 'Full access to expenses, settings, and reports',
  submitter: 'View and correct your own flagged expense reports',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const sendgridApiKey = Deno.env.get('SENDGRID_API_KEY')
    const siteUrl = Deno.env.get('SITE_URL') || 'https://expenses.as3.mx'

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables')
    }

    if (!sendgridApiKey) {
      throw new Error('Missing SENDGRID_API_KEY environment variable')
    }

    // Create service role client (bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Get authorization header and verify user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create client with user's token to verify their identity
    const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: { Authorization: authHeader }
      }
    })

    // Get the requesting user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify user is an admin
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role, is_active, full_name')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (profile.role !== 'admin' || !profile.is_active) {
      return new Response(
        JSON.stringify({ error: 'Only active admins can invite users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const body: InviteRequest = await req.json()

    if (!body.email || !body.full_name || !body.role) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: email, full_name, role' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate role
    if (!['admin', 'bookkeeper', 'submitter'].includes(body.role)) {
      return new Response(
        JSON.stringify({ error: 'Invalid role. Must be admin, bookkeeper, or submitter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if email already exists in user_profiles
    const { data: existingUser } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('email', body.email)
      .single()

    if (existingUser) {
      return new Response(
        JSON.stringify({ error: 'A user with this email already exists' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check for pending invitation
    const { data: existingInvite } = await supabaseAdmin
      .from('user_invitations')
      .select('id, status')
      .eq('email', body.email)
      .eq('status', 'pending')
      .single()

    if (existingInvite) {
      return new Response(
        JSON.stringify({ error: 'A pending invitation already exists for this email' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create invitation record
    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from('user_invitations')
      .insert({
        email: body.email,
        full_name: body.full_name,
        role: body.role,
        invited_by: user.id,
        status: 'pending',
      })
      .select('id, token, expires_at')
      .single()

    if (inviteError || !invitation) {
      console.error('Invitation insert error:', inviteError)
      return new Response(
        JSON.stringify({ error: 'Failed to create invitation' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build invitation URL
    const inviteUrl = `${siteUrl}/accept-invite?token=${invitation.token}`
    const expiresAt = new Date(invitation.expires_at)
    const expiresFormatted = expiresAt.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    // Generate email HTML
    const emailHtml = getInvitationEmailHtml({
      inviteeName: body.full_name,
      inviterName: profile.full_name,
      role: body.role,
      roleDescription: ROLE_DESCRIPTIONS[body.role],
      inviteUrl,
      expiresDate: expiresFormatted,
    })

    // Send email via SendGrid
    const sendgridResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: body.email, name: body.full_name }],
            subject: `You're invited to join AS3 Expense Dashboard`,
          }
        ],
        from: {
          email: 'noreply@as3drivertraining.com',
          name: 'AS3 Driver Training',
        },
        reply_to: {
          email: 'support@as3drivertraining.com',
          name: 'AS3 Support',
        },
        content: [
          {
            type: 'text/html',
            value: emailHtml,
          }
        ],
        tracking_settings: {
          click_tracking: { enable: true },
          open_tracking: { enable: true },
        },
      }),
    })

    if (!sendgridResponse.ok) {
      const errorText = await sendgridResponse.text()
      console.error('SendGrid error:', sendgridResponse.status, errorText)

      // Still return success since invitation was created
      // User can resend if email fails
      return new Response(
        JSON.stringify({
          success: true,
          invitation_id: invitation.id,
          warning: 'Invitation created but email delivery may have failed',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Invitation sent successfully to ${body.email}`)

    return new Response(
      JSON.stringify({
        success: true,
        invitation_id: invitation.id,
        message: `Invitation sent to ${body.email}`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Edge Function error:', error)
    return new Response(
      JSON.stringify({
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
