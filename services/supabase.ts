// services/supabase.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = 'https://khoruzvsprxyocisuhet.supabase.co';
const SUPABASE_ANON = 'sb_publishable_SmAKKGV9YOiY4OirEg36yg_hNU4Adg5';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage:              AsyncStorage,
    autoRefreshToken:     true,
    persistSession:       true,
    detectSessionInUrl:   false,
  },
});