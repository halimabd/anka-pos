import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { paket, klien_id } = await req.json();
    if (!klien_id) throw new Error("klien_id wajib dikirim!");

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Ambil pengaturan sistem master
    const { data: sys, error: errSys } = await supabaseAdmin
      .from('pengaturan_sistem')
      .select('*')
      .limit(1)
      .single();

    if (errSys || !sys) throw new Error("Pengaturan sistem belum dikonfigurasi di database!");
    if (!sys.midtrans_server_key) throw new Error("Server Key Master Midtrans kosong!");

    // 2. Ambil data asli klien (nama dan email) dari tabel data_klien berdasarkan klien_id
    const { data: klienData, error: errKlien } = await supabaseAdmin
      .from('data_klien')
      .select('nama, email')
      .eq('klien_id', klien_id)
      .single();

    // Jika email di database kosong atau tidak valid, gunakan email cadangan yang valid
    let namaKlien = klienData?.nama || "Klien ANKA POS";
    let emailKlien = klienData?.email;
    if (!emailKlien || !emailKlien.includes('@')) {
      emailKlien = "klien@ankapos.com"; 
    }

    let nominal = 0;
    let kodePaket = "";

    if (paket === "bulanan") {
      nominal = sys.harga_bulanan;
      kodePaket = "BLN";
    } else if (paket === "tahunan") {
      nominal = sys.harga_tahunan;
      kodePaket = "THN";
    } else {
      throw new Error("Pilihan paket tidak valid");
    }

    const apiUrl = sys.midtrans_env === "production" 
      ? "https://app.midtrans.com/snap/v1/transactions" 
      : "https://app.sandbox.midtrans.com/snap/v1/transactions";

    // 3. Format Order ID singkat (< 36 karakter)
    let singkatId = klien_id.replace(/-/g, '').slice(-6);
    let angkaUnik = Date.now().toString().slice(-6);
    const orderId = `S-${kodePaket}-${singkatId}-${angkaUnik}`;

    const payload = {
      transaction_details: { order_id: orderId, gross_amount: nominal },
      customer_details: { 
        first_name: namaKlien, 
        email: emailKlien // ✨ Sekarang dijamin menggunakan format email yang valid
      },
      callbacks: { finish: "https://anka-pos.vercel.app/#" }
    };

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