import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export default {
  fetch: withSupabase({ auth: ["publishable", "secret"] }, async (req, ctx) => {
    // 1. Tangani CORS agar tidak diblokir oleh browser aplikasi POS Anda
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    try {
      const { total, pelanggan, klien_id } = await req.json();
      
      if (!klien_id) throw new Error("klien_id wajib dikirim!");

      // 2. Ambil pengaturan menggunakan ctx.supabaseAdmin (Bypass RLS)
      const { data: pengaturan, error: errPengaturan } = await ctx.supabaseAdmin
        .from('pengaturan')
        .select('midtransServerKey, midtransEnv')
        .eq('klien_id', klien_id)
        .single();

      if (errPengaturan || !pengaturan || !pengaturan.midtransServerKey) {
        throw new Error("Server Key Midtrans belum diatur oleh Owner!");
      }

      // 3. Tentukan URL Midtrans
      const apiUrl = pengaturan.midtransEnv === "production" 
        ? "https://app.midtrans.com/snap/v1/transactions" 
        : "https://app.sandbox.midtrans.com/snap/v1/transactions";

      const orderId = "INV-" + new Date().getTime();
      
      const payload = {
        transaction_details: { order_id: orderId, gross_amount: Math.round(total) },
        customer_details: { first_name: pelanggan || "Pelanggan Umum" }
      };

      // 4. Minta Token ke Midtrans
      const authHeader = "Basic " + btoa(pengaturan.midtransServerKey + ":");
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
        throw new Error(dataMidtrans.error_messages?.[0] || "Gagal mendapatkan token dari Midtrans");
      }

    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 400 
      });
    }
  }),
};
