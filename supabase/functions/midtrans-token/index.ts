import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Tangani CORS (Wajib)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { total, pelanggan, klien_id } = await req.json();
    
    if (!klien_id) throw new Error("klien_id wajib dikirim dari kasir!");

    // Akses database mode Admin
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Ambil kunci Midtrans milik Klien
    const { data: pengaturan, error: errPengaturan } = await supabaseAdmin
      .from('pengaturan')
      .select('midtransServerKey, midtransEnv')
      .eq('klien_id', klien_id)
      .single();

    if (errPengaturan || !pengaturan || !pengaturan.midtransServerKey) {
      throw new Error("Server Key Midtrans belum diatur oleh Pemilik Toko!");
    }

    const apiUrl = pengaturan.midtransEnv === "production" 
      ? "https://app.midtrans.com/snap/v1/transactions" 
      : "https://app.sandbox.midtrans.com/snap/v1/transactions";

    // Format Order ID
    const idSingkat = klien_id.replace(/-/g, '').substring(0, 6).toUpperCase();
    const timestamp = new Date().getTime().toString().slice(-6);
    const orderId = `INV-${idSingkat}-${timestamp}`; 

    // Waktu Kedaluwarsa (+7 WIB)
    const d = new Date();
    d.setUTCHours(d.getUTCHours() + 7);
    const pad = (n) => n < 10 ? '0' + n : n;
    const orderTime = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0700`;
    
    const payload = {
      transaction_details: { order_id: orderId, gross_amount: Math.round(total) },
      customer_details: { first_name: pelanggan || "Pelanggan Umum" },
      custom_expiry: { order_time: orderTime, expiry_duration: 15, unit: "minute" },
      callbacks: { finish: "https://anka-pos.vercel.app/#" }
    };

    // 👇 PENTING: Ganti INI DENGAN URL SUPABASE ANDA YANG ASLI 👇
    const webhookUrl = "https://[GANTI_DENGAN_PROJECT_ID_ANDA].supabase.co/functions/v1/midtrans-webhook";

    // Minta Token ke Midtrans
    const authHeader = "Basic " + btoa(pengaturan.midtransServerKey + ":");
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 
          'Accept': 'application/json', 
          'Content-Type': 'application/json', 
          'Authorization': authHeader,
          'X-Override-Notification': webhookUrl
      },
      body: JSON.stringify(payload)
    });

    const dataMidtrans = await response.json();

    if (dataMidtrans.token) {
      return new Response(JSON.stringify({ token: dataMidtrans.token, order_id: orderId }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    } else {
      throw new Error(dataMidtrans.error_messages?.[0] || "Gagal mendapatkan token Midtrans");
    }

  } catch (error) {
    // Jika ada error, kirim status 400 ke Frontend (Ini yang memicu pesan non-2xx status code)
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
      status: 400 
    });
  }
});