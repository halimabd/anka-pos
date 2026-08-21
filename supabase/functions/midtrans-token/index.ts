import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export default {
  fetch: withSupabase({ auth: ["publishable", "secret"] }, async (req, ctx) => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    try {
      const { total, pelanggan, klien_id } = await req.json();
      
      if (!klien_id) throw new Error("klien_id wajib dikirim!");

      const { data: pengaturan, error: errPengaturan } = await ctx.supabaseAdmin
        .from('pengaturan')
        .select('midtransServerKey, midtransEnv')
        .eq('klien_id', klien_id)
        .single();

      if (errPengaturan || !pengaturan || !pengaturan.midtransServerKey) {
        throw new Error("Server Key Midtrans belum diatur oleh Owner!");
      }

      const apiUrl = pengaturan.midtransEnv === "production" 
        ? "https://app.midtrans.com/snap/v1/transactions" 
        : "https://app.sandbox.midtrans.com/snap/v1/transactions";

      // ✨ PERBAIKAN 1: ORDER ID PINTAR (Masukkan identitas klien)
      // Ambil 6 karakter pertama dari klien_id untuk menghemat tempat
      const idSingkat = klien_id.replace(/-/g, '').substring(0, 6).toUpperCase();
      const timestamp = new Date().getTime().toString().slice(-6); // 6 digit akhir waktu
      const orderId = `INV-${idSingkat}-${timestamp}`; 
      // Hasilnya contoh: INV-A1B2C3-123456

      const d = new Date();
      d.setUTCHours(d.getUTCHours() + 7);
      const pad = (n: number) => n < 10 ? '0' + n : n;
      const orderTime = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0700`;
      
      const payload = {
        transaction_details: { order_id: orderId, gross_amount: Math.round(total) },
        customer_details: { first_name: pelanggan || "Pelanggan Umum" },
        custom_expiry: {
            order_time: orderTime,
            expiry_duration: 15, 
            unit: "minute"       
        },
        callbacks: {
            finish: "https://anka-pos.vercel.app/#" 
        }
      };

      // ✨ PERBAIKAN 2: URL WEBHOOK OTOMATIS (Ganti dengan URL URL Edge Function Webhook Anda)
      // Ingat: Ganti [PROJECT-REF] dengan ID Project Supabase Anda!
      const webhookUrl = "https://xnbsbfhyzcwsofcydybw.supabase.co/functions/v1/midtrans-webhook";

      const authHeader = "Basic " + btoa(pengaturan.midtransServerKey + ":");
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 
            'Accept': 'application/json', 
            'Content-Type': 'application/json', 
            'Authorization': authHeader,
            // ✨ PERBAIKAN 3: SUNTIKAN HEADER AJAIB INI!
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