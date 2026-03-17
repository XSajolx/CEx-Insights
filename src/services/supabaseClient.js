import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Debug: Log environment variable status (not values for security)
console.log('🔧 Supabase Config:', {
    urlSet: !!supabaseUrl,
    urlStart: supabaseUrl?.substring(0, 30) + '...',
    keySet: !!supabaseAnonKey,
    keyStart: supabaseAnonKey?.substring(0, 20) + '...',
    keyLength: supabaseAnonKey?.length
})

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('❌ Supabase URL or Anon Key is missing in environment variables.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
