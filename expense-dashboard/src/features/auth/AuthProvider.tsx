import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { UserProfile, UserRole } from '@/types/database'
import { type Permission, ROLE_PERMISSIONS, type NavItemKey, NAV_VISIBILITY } from '@/types/auth'

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  hasPermission: (permission: Permission) => boolean
  isRole: (role: UserRole | UserRole[]) => boolean
  canSeeNav: (navItem: NavItemKey) => boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('Error fetching profile:', error.message)
        setProfile(null)
        return
      }

      setProfile(data as UserProfile)

      // Update last_login_at
      await supabase
        .from('user_profiles')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', userId)
    } catch (err) {
      console.error('Error in fetchProfile:', err)
      setProfile(null)
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      await fetchProfile(user.id)
    }
  }, [user?.id, fetchProfile])

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setIsLoading(false))
      } else {
        setIsLoading(false)
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          fetchProfile(session.user.id).finally(() => setIsLoading(false))
        } else {
          setProfile(null)
          setIsLoading(false)
        }
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { error: error as Error | null }
  }

  const signOut = async () => {
    setProfile(null)
    await supabase.auth.signOut()
  }

  const hasPermission = useCallback((permission: Permission): boolean => {
    if (!profile?.role) return false
    return ROLE_PERMISSIONS[profile.role]?.includes(permission) ?? false
  }, [profile?.role])

  const isRole = useCallback((role: UserRole | UserRole[]): boolean => {
    if (!profile?.role) return false
    if (Array.isArray(role)) {
      return role.includes(profile.role)
    }
    return profile.role === role
  }, [profile?.role])

  const canSeeNav = useCallback((navItem: NavItemKey): boolean => {
    // If no profile yet, show all items (backwards compatibility for loading state)
    if (!profile?.role) return true
    return NAV_VISIBILITY[navItem]?.includes(profile.role) ?? false
  }, [profile?.role])

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      isLoading,
      signIn,
      signOut,
      hasPermission,
      isRole,
      canSeeNav,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
