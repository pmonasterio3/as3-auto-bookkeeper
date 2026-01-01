// Supabase Edge Function: accept-invite
// Validates invitation token and creates user account with profile
// Two endpoints:
// - GET with token query param: Validates token and returns invitation details
// - POST with token and password: Creates user and marks invitation accepted

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AcceptRequest {
  token: string
  password: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase admin client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables')
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      }
    })

    // GET: Validate token and return invitation details
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const token = url.searchParams.get('token')

      if (!token) {
        return new Response(
          JSON.stringify({ error: 'Missing token parameter' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Fetch invitation by token
      const { data: invitation, error: fetchError } = await supabaseAdmin
        .from('user_invitations')
        .select('id, email, full_name, role, status, expires_at, invited_at')
        .eq('token', token)
        .single()

      if (fetchError || !invitation) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired invitation token' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check if already accepted
      if (invitation.status === 'accepted') {
        return new Response(
          JSON.stringify({ error: 'This invitation has already been accepted' }),
          { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check if revoked
      if (invitation.status === 'revoked') {
        return new Response(
          JSON.stringify({ error: 'This invitation has been revoked' }),
          { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check if expired
      const expiresAt = new Date(invitation.expires_at)
      if (expiresAt < new Date()) {
        // Update status to expired
        await supabaseAdmin
          .from('user_invitations')
          .update({ status: 'expired' })
          .eq('id', invitation.id)

        return new Response(
          JSON.stringify({ error: 'This invitation has expired' }),
          { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Return invitation details (without sensitive data)
      return new Response(
        JSON.stringify({
          valid: true,
          email: invitation.email,
          full_name: invitation.full_name,
          role: invitation.role,
          expires_at: invitation.expires_at,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // POST: Accept invitation and create user account
    if (req.method === 'POST') {
      const body: AcceptRequest = await req.json()

      if (!body.token || !body.password) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: token, password' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Validate password strength
      if (body.password.length < 8) {
        return new Response(
          JSON.stringify({ error: 'Password must be at least 8 characters long' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Fetch invitation by token
      const { data: invitation, error: fetchError } = await supabaseAdmin
        .from('user_invitations')
        .select('*')
        .eq('token', body.token)
        .single()

      if (fetchError || !invitation) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired invitation token' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Validate invitation status
      if (invitation.status !== 'pending') {
        return new Response(
          JSON.stringify({ error: `Invitation status is '${invitation.status}', cannot accept` }),
          { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check expiration
      if (new Date(invitation.expires_at) < new Date()) {
        await supabaseAdmin
          .from('user_invitations')
          .update({ status: 'expired' })
          .eq('id', invitation.id)

        return new Response(
          JSON.stringify({ error: 'This invitation has expired' }),
          { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Create auth user
      const { data: authUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
        email: invitation.email,
        password: body.password,
        email_confirm: true, // Auto-confirm since invitation is verified
        user_metadata: {
          full_name: invitation.full_name,
        },
      })

      if (createUserError) {
        console.error('User creation error:', createUserError)

        // Check for duplicate email
        if (createUserError.message.includes('already been registered')) {
          return new Response(
            JSON.stringify({ error: 'An account with this email already exists' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        return new Response(
          JSON.stringify({ error: `Failed to create user: ${createUserError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!authUser.user) {
        return new Response(
          JSON.stringify({ error: 'User creation returned no user' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Create user profile
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          id: authUser.user.id,
          email: invitation.email,
          full_name: invitation.full_name,
          role: invitation.role,
          invited_by: invitation.invited_by,
          invited_at: invitation.invited_at,
          is_active: true,
        })

      if (profileError) {
        console.error('Profile creation error:', profileError)
        // User was created but profile failed - try to delete user
        await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)

        return new Response(
          JSON.stringify({ error: `Failed to create profile: ${profileError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Mark invitation as accepted
      await supabaseAdmin
        .from('user_invitations')
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString(),
          user_id: authUser.user.id,
        })
        .eq('id', invitation.id)

      console.log(`User ${invitation.email} created successfully with role ${invitation.role}`)

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Account created successfully. You can now sign in.',
          email: invitation.email,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Unsupported method
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Edge Function error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
