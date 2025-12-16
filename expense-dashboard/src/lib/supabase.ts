import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fzwozzqwyzztadxgjryl.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6d296enF3eXp6dGFkeGdqcnlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3OTMwMDIsImV4cCI6MjA4MDM2OTAwMn0.Lvhy3-rCnb8gh2XyN_P8KhApC-PfgtFOyDwDBh4OByc'

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})

export type { Database }
