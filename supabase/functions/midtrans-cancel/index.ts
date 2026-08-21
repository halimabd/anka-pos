import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { no_struk, klien_id } = await req.json();
    
    if (!no_struk || !klien_id) throw new Error("no_struk dan klien_id wajib dikirim!");

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Ambil Server Key milik klien dari tabel pengaturan
    const { data: pengaturan, error: errPengaturan } = await supabaseAdmin
      .from('pengaturan')
      .select('midtransServerKey, midtransEnv')
      .eq('klien_id', klien_id)
      .single();

    if (errPengaturan || !pengaturan || !pengaturan.midtransServerKey) {
      throw new Error("Server Key Midtrans tidak ditemukan.");
    }

    // Tentukan URL API Core Midtrans untuk Cancel
    const baseUrl = pengaturan.midtransEnv === "production" 
      ? "https://api.midtrans.com" 
      : "https://api.sandbox.midtrans.com";
      
    const cancelUrl = `${baseUrl}/v2/${no_struk}/cancel`;

    const authHeader = "Basic " + btoa(pengaturan.midtransServerKey + ":");
    
    // Tembak API Midtrans untuk membatalkan pesanan
    const response = await fetch(cancelUrl, {
      method: 'POST',
      headers: { 
          'Accept': 'application/json', 
          'Content-Type': 'application/json', 
          'Authorization': authHeader 
      }
    });

    const result = await response.json();

    return new Response(JSON.stringify({ success: true, midtransResponse: result }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
      status: 400 
    });
  }
});