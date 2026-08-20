import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { paket, klien_id, nama, email } = await req.json();
    if (!klien_id) throw new Error("klien_id wajib dikirim!");

    // 1. Buat koneksi Admin Supabase
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 2. Ambil Pengaturan Sistem Master dari Database
    const { data: sys, error: errSys } = await supabaseAdmin
      .from('pengaturan_sistem')
      .select('*')
      .limit(1)
      .single();

    if (errSys || !sys) throw new Error("Pengaturan sistem belum dikonfigurasi di database!");
    if (!sys.midtrans_server_key) throw new Error("Server Key Master Midtrans kosong!");

    // 3. Tentukan Harga Berdasarkan Database
    let nominal = 0;
    let kodePaket = "";

    if (paket === "bulanan") {
      nominal = sys.harga_bulanan;
      kodePaket = "BULAN";
    } else if (paket === "tahunan") {
      nominal = sys.harga_tahunan;
      kodePaket = "TAHUN";
    } else {
      throw new Error("Pilihan paket tidak valid");
    }

    // 4. Siapkan Midtrans (Sandbox vs Production)
    const apiUrl = sys.midtrans_env === "production" 
      ? "https://app.midtrans.com/snap/v1/transactions" 
      : "https://app.sandbox.midtrans.com/snap/v1/transactions";

    // Ambil 6 karakter terakhir dari klien_id agar tetap unik tapi sangat singkat
    let singkatId = klien_id.replace(/-/g, '').slice(-6);
    let angkaUnik = Date.now().toString().slice(-6); // 6 digit terakhir timestamp

    // Format baru: SAAS-BULAN-abc123-456789 (Total dijamin di bawah 36 karakter)
    const orderId = `SAAS-${kodePaket}-${singkatId}-${angkaUnik}`;

    const payload = {
      transaction_details: { order_id: orderId, gross_amount: nominal },
      customer_details: { first_name: nama || "Klien ANKA POS", email: email || "" },
      callbacks: { finish: "https://anka-pos.vercel.app/#" }
    };

    // 5. Tembak ke Midtrans
    const authHeader = "Basic " + btoa(sys.midtrans_server_key + ":");
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(payload)
    });

    const dataMidtrans = await response.json();
    
    if (dataMidtrans.token) {
      return new Response(JSON.stringify({ token: dataMidtrans.token, order_id: orderId }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    } else {
      throw new Error(dataMidtrans.error_messages?.[0] || "Gagal mendapatkan token SAAS dari Midtrans");
    }

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    });
  }
});